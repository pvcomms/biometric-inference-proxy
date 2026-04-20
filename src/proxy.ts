import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { kv } from "./kv.js";
import { getInferenceParams } from "./conditioner.js";
import {
  buildAnthropicRequest,
  openAISseChunk,
  openAISseDone,
  openAIFinishChunk,
  buildOpenAIResponse,
} from "./transform.js";
import type { BiometricMode, OpenAIChatRequest } from "./types.js";
import {
  walk,
  classifyRequestType,
  inferIntent,
  recoveryTier,
  type DecisionFacts,
  type DecisionResult,
} from "./decision-tree.js";
import { publish, type RequestEvent } from "./stream-bus.js";
import { estimateCost } from "./cost.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const VALID_MODES: BiometricMode[] = ["red", "yellow", "green", "peak"];

async function decideMode(
  body: OpenAIChatRequest,
  overrideHeader: string | undefined,
): Promise<{ decision: DecisionResult; override: boolean }> {
  const forcedEnv = process.env.FORCE_MODE as BiometricMode | undefined;
  const override =
    overrideHeader && VALID_MODES.includes(overrideHeader as BiometricMode)
      ? (overrideHeader as BiometricMode)
      : undefined;

  const state = await kv.getBiometricState();
  const score = state?.recovery_score ?? 50;
  const tier = recoveryTier(score);

  const firstUser = body.messages.find((m) => m.role === "user")?.content ?? "";
  const request_type = classifyRequestType(firstUser);
  const intent = inferIntent(firstUser);
  const hour = new Date().getHours();
  const total_chars = body.messages.reduce(
    (n, m) => n + (m.content?.length ?? 0),
    0,
  );

  const facts: DecisionFacts = {
    recovery_tier: tier,
    recovery_score: score,
    request_type,
    intent,
    hour,
    message_count: body.messages.length,
    total_chars,
  };

  if (override) {
    return {
      decision: {
        mode: override,
        path: ["override", `mode_${override}`],
        facts,
      },
      override: true,
    };
  }
  if (forcedEnv && VALID_MODES.includes(forcedEnv)) {
    return {
      decision: {
        mode: forcedEnv,
        path: ["force_env", `mode_${forcedEnv}`],
        facts,
      },
      override: false,
    };
  }

  return { decision: walk(facts), override: false };
}

export async function handleChatCompletion(c: Context): Promise<Response> {
  let body: OpenAIChatRequest;
  try {
    body = await c.req.json<OpenAIChatRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return c.json({ error: "messages array is required" }, 400);
  }

  const started = Date.now();
  const overrideHeader = c.req.header("x-override-mode");
  const { decision, override } = await decideMode(body, overrideHeader);
  const mode = decision.mode;
  const params = getInferenceParams(mode);

  const anthropicReq = buildAnthropicRequest(
    body.messages,
    body.model ?? "gpt-4",
    params,
    body.max_tokens,
    body.stream ?? false,
  );

  console.log(
    `[proxy] mode=${mode} path=${decision.path.join(">")} model=${anthropicReq.model} thinking=${!!anthropicReq.thinking} override=${override}`,
  );

  const ctx = {
    id: randomUUID(),
    started,
    mode,
    path: decision.path,
    model: anthropicReq.model,
    request_type: decision.facts.request_type,
    intent: decision.facts.intent,
    override,
  };

  if (body.stream) {
    return streamResponse(
      c,
      anthropicReq,
      body.model ?? anthropicReq.model,
      ctx,
    );
  }

  return nonStreamResponse(
    c,
    anthropicReq,
    body.model ?? anthropicReq.model,
    ctx,
  );
}

interface RequestCtx {
  id: string;
  started: number;
  mode: BiometricMode;
  path: string[];
  model: string;
  request_type: string;
  intent: string;
  override: boolean;
}

function emit(
  ctx: RequestCtx,
  inputTokens: number,
  outputTokens: number,
  status: "ok" | "error",
): void {
  const ev: RequestEvent = {
    id: ctx.id,
    ts: new Date().toISOString(),
    mode: ctx.mode,
    path: ctx.path,
    model: ctx.model,
    request_type: ctx.request_type,
    intent: ctx.intent,
    latency_ms: Date.now() - ctx.started,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimateCost(ctx.model, inputTokens, outputTokens),
    override: ctx.override,
    status,
  };
  publish(ev);
}

async function streamResponse(
  c: Context,
  anthropicReq: ReturnType<typeof buildAnthropicRequest>,
  originalModel: string,
  ctx: RequestCtx,
): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const anthropicStream = await anthropic.messages.stream(anthropicReq);

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = openAISseChunk(event.delta.text, originalModel);
            controller.enqueue(encoder.encode(chunk));
          } else if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? outputTokens;
          } else if (event.type === "message_start" && "message" in event) {
            inputTokens = event.message.usage?.input_tokens ?? inputTokens;
            outputTokens = event.message.usage?.output_tokens ?? outputTokens;
          }
        }

        controller.enqueue(encoder.encode(openAIFinishChunk(originalModel)));
        controller.enqueue(encoder.encode(openAISseDone()));
        controller.close();
        emit(ctx, inputTokens, outputTokens, "ok");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
        );
        controller.close();
        emit(ctx, inputTokens, outputTokens, "error");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-proxy-mode": ctx.mode,
      "x-proxy-path": ctx.path.join(">"),
    },
  });
}

async function nonStreamResponse(
  c: Context,
  anthropicReq: ReturnType<typeof buildAnthropicRequest>,
  originalModel: string,
  ctx: RequestCtx,
): Promise<Response> {
  try {
    const response = await anthropic.messages.create({
      ...anthropicReq,
      stream: false,
    });

    const textContent = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    const result = buildOpenAIResponse(
      textContent,
      originalModel,
      response.usage.input_tokens,
      response.usage.output_tokens,
    );

    emit(ctx, response.usage.input_tokens, response.usage.output_tokens, "ok");
    c.header("x-proxy-mode", ctx.mode);
    c.header("x-proxy-path", ctx.path.join(">"));
    return c.json(result);
  } catch (err) {
    emit(ctx, 0, 0, "error");
    throw err;
  }
}
