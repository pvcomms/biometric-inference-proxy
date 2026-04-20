import type { BiometricMode } from "./types.js";

export interface RequestEvent {
  id: string;
  ts: string;
  mode: BiometricMode;
  path: string[];
  model: string;
  request_type: string;
  intent: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  override: boolean;
  status: "ok" | "error";
}

type Listener = (ev: RequestEvent) => void;

const listeners = new Set<Listener>();
const ring: RequestEvent[] = [];
const RING_MAX = 200;

export function publish(ev: RequestEvent): void {
  ring.push(ev);
  if (ring.length > RING_MAX) ring.shift();
  for (const l of listeners) {
    try {
      l(ev);
    } catch {
      // swallow listener errors so one bad client can't poison the bus
    }
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function recent(limit = 50): RequestEvent[] {
  return ring.slice(-limit);
}
