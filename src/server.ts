import { Hono } from "hono";
import { handleChatCompletion } from "./proxy.js";
import { runPoll } from "./poller.js";
import { kv } from "./kv.js";

export function createApp() {
  const app = new Hono();

  // Auth middleware (optional PROXY_API_KEY)
  app.use("/v1/*", async (c, next) => {
    const apiKey = process.env.PROXY_API_KEY;
    if (!apiKey) return next();

    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${apiKey}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/status", async (c) => {
    const state = await kv.getBiometricState();
    const forced = process.env.FORCE_MODE;
    return c.json({
      biometric: state,
      force_mode: forced ?? null,
      effective_mode: forced ?? state?.mode ?? "yellow",
    });
  });

  app.post("/poll", async (c) => {
    try {
      const state = await runPoll();
      return c.json({ ok: true, state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.post("/v1/chat/completions", handleChatCompletion);

  // Catch-all for unmatched routes
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
