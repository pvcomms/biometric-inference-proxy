import { serve } from "@hono/node-server";
import { createApp } from "./server.js";
import { startPoller } from "./poller.js";

const port = parseInt(process.env.PORT ?? "3000", 10);
const pollInterval = parseInt(process.env.POLL_INTERVAL_MS ?? "600000", 10);

const app = createApp();

const pollerTimer = startPoller(pollInterval);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
  console.log(`[server] poll interval: ${pollInterval}ms`);
});

function shutdown() {
  console.log("[server] shutting down...");
  clearInterval(pollerTimer);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
