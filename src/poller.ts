import { fetchLatestRecovery } from "./whoop.js";
import { kv } from "./kv.js";
import { recoveryToMode } from "./conditioner.js";
import type { BiometricState } from "./types.js";

export async function runPoll(): Promise<BiometricState> {
  const { recovery_score, hrv_rmssd } = await fetchLatestRecovery();
  const mode = recoveryToMode(recovery_score);

  const state: BiometricState = {
    recovery_score,
    hrv_rmssd,
    mode,
    updated_at: new Date().toISOString(),
  };

  await kv.setBiometricState(state);

  console.log(
    `[poller] recovery=${recovery_score}% hrv=${hrv_rmssd}ms mode=${mode}`,
  );

  return state;
}

export function startPoller(intervalMs: number): NodeJS.Timeout {
  console.log(`[poller] starting, interval=${intervalMs}ms`);

  // Run immediately on start
  runPoll().catch((err) => console.error("[poller] initial poll failed:", err));

  return setInterval(() => {
    runPoll().catch((err) => console.error("[poller] poll failed:", err));
  }, intervalMs);
}
