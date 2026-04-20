// Rough per-1M-token prices in USD. Tweak as Anthropic pricing evolves.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4": { in: 15, out: 75 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 0.8, out: 4 },
};

function pick(model: string): { in: number; out: number } {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  return key ? PRICES[key] : PRICES["claude-sonnet-4-6"];
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = pick(model);
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out;
}
