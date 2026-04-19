import type { BiometricMode, InferenceParams } from "./types.js";

const PARAMS: Record<BiometricMode, InferenceParams> = {
  red: {
    temperature: 0.3,
    thinking_tokens: 8192,
    system_prefix: "Be precise, conservative, concise. No speculation.",
    max_tokens: 2048,
    use_thinking: false,
  },
  yellow: {
    temperature: 0.7,
    thinking_tokens: 16384,
    system_prefix: "",
    max_tokens: 4096,
    use_thinking: false,
  },
  green: {
    temperature: 1.0,
    thinking_tokens: 32768,
    system_prefix: "Explore multiple angles. Be thorough.",
    max_tokens: 8192,
    use_thinking: true,
  },
  peak: {
    temperature: 1.2,
    thinking_tokens: 65536,
    system_prefix:
      "Think expansively. Make creative connections. Consider unconventional approaches.",
    max_tokens: 16384,
    use_thinking: true,
  },
};

export function recoveryToMode(score: number): BiometricMode {
  if (score < 33) return "red";
  if (score < 66) return "yellow";
  if (score < 85) return "green";
  return "peak";
}

export function getInferenceParams(mode: BiometricMode): InferenceParams {
  return PARAMS[mode];
}
