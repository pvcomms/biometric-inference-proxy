import { Hono } from "hono";
import { handleChatCompletion } from "./proxy.js";
import { runPoll } from "./poller.js";
import { kv } from "./kv.js";
import { handleStream, handleStreamView } from "./stream.js";
import { clearTreeCache, loadTree } from "./decision-tree.js";

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

  app.get("/stream", handleStream);
  app.get("/stream/view", handleStreamView);

  app.get("/decision-tree", (c) => {
    try {
      return c.json(loadTree());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  app.post("/decision-tree/reload", (c) => {
    clearTreeCache();
    try {
      const tree = loadTree();
      return c.json({
        ok: true,
        root: tree.root,
        nodes: Object.keys(tree.nodes).length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  // Catch-all for unmatched routes
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
