#!/usr/bin/env tsx
import "../src/kv.js";
import { runPoll } from "../src/poller.js";

// Standalone one-shot poller — invoke via cron or manually
// Usage: pnpm poll

(async () => {
  try {
    const state = await runPoll();
    console.log("[poll] done:", JSON.stringify(state, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("[poll] failed:", err);
    process.exit(1);
  }
})();
