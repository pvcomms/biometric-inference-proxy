import type {
  OpenAIMessage,
  AnthropicMessage,
  AnthropicRequest,
  InferenceParams,
} from "./types.js";

const OPENAI_TO_CLAUDE_MODEL = "claude-opus-4-7";
const CLAUDE_MODEL_PREFIX = "claude-";

function resolveModel(model: string): string {
  if (model.startsWith(CLAUDE_MODEL_PREFIX)) return model;
  return process.env.DEFAULT_MODEL ?? OPENAI_TO_CLAUDE_MODEL;
}

export function buildAnthropicRequest(
  messages: OpenAIMessage[],
  model: string,
  params: InferenceParams,
  callerMaxTokens?: number,
  stream?: boolean,
): AnthropicRequest {
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  const systemParts: string[] = [];
  if (params.system_prefix) systemParts.push(params.system_prefix);
  if (systemMessages.length > 0) {
    systemParts.push(...systemMessages.map((m) => m.content));
  }

  const anthropicMessages: AnthropicMessage[] = conversationMessages.map(
    (m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }),
  );

  const maxTokens = callerMaxTokens
    ? Math.max(callerMaxTokens, params.max_tokens)
    : params.max_tokens;

  const req: AnthropicRequest = {
    model: resolveModel(model),
    messages: anthropicMessages,
    max_tokens: maxTokens,
    stream,
  };

  if (systemParts.length > 0) {
    req.system = systemParts.join("\n\n");
  }

  if (params.use_thinking) {
    req.thinking = {
      type: "enabled",
      budget_tokens: params.thinking_tokens,
    };
    // Anthropic ignores temperature when thinking is enabled — omit it
  } else {
    req.temperature = params.temperature;
  }

  return req;
}

export function openAISseChunk(content: string, model: string): string {
  const chunk = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function openAISseDone(): string {
  return "data: [DONE]\n\n";
}

export function openAIFinishChunk(model: string): string {
  const chunk = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function buildOpenAIResponse(
  content: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}
