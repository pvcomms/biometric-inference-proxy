import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { kv } from "./kv.js";
import { recoveryToMode, getInferenceParams } from "./conditioner.js";
import {
  buildAnthropicRequest,
  openAISseChunk,
  openAISseDone,
  openAIFinishChunk,
  buildOpenAIResponse,
} from "./transform.js";
import type { BiometricMode, OpenAIChatRequest } from "./types.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function resolveMode(): Promise<BiometricMode> {
  const forced = process.env.FORCE_MODE as BiometricMode | undefined;
  if (forced && ["red", "yellow", "green", "peak"].includes(forced)) {
    return forced;
  }

  const state = await kv.getBiometricState();
  if (!state) {
    console.warn("[proxy] no biometric state in KV, defaulting to yellow");
    return "yellow";
  }
  return recoveryToMode(state.recovery_score);
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

  const mode = await resolveMode();
  const params = getInferenceParams(mode);

  const anthropicReq = buildAnthropicRequest(
    body.messages,
    body.model ?? "gpt-4",
    params,
    body.max_tokens,
    body.stream ?? false,
  );

  console.log(
    `[proxy] mode=${mode} model=${anthropicReq.model} thinking=${!!anthropicReq.thinking} max_tokens=${anthropicReq.max_tokens}`,
  );

  if (body.stream) {
    return streamResponse(c, anthropicReq, body.model ?? anthropicReq.model);
  }

  return nonStreamResponse(c, anthropicReq, body.model ?? anthropicReq.model);
}

async function streamResponse(
  c: Context,
  anthropicReq: ReturnType<typeof buildAnthropicRequest>,
  originalModel: string,
): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = await anthropic.messages.stream(anthropicReq);

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = openAISseChunk(event.delta.text, originalModel);
            controller.enqueue(encoder.encode(chunk));
          }
        }

        controller.enqueue(encoder.encode(openAIFinishChunk(originalModel)));
        controller.enqueue(encoder.encode(openAISseDone()));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function nonStreamResponse(
  c: Context,
  anthropicReq: ReturnType<typeof buildAnthropicRequest>,
  originalModel: string,
): Promise<Response> {
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

  return c.json(result);
}
