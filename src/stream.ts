import type { Context } from "hono";
import { subscribe, recent } from "./stream-bus.js";

export async function handleStream(c: Context): Promise<Response> {
  const encoder = new TextEncoder();
  const modeFilter = c.req.query("mode");

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown, event?: string) => {
        const prefix = event ? `event: ${event}\n` : "";
        controller.enqueue(
          encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`),
        );
      };

      send({ hello: true, ts: new Date().toISOString() }, "hello");

      for (const ev of recent(30)) {
        if (modeFilter && ev.mode !== modeFilter) continue;
        send(ev, "request");
      }

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      const unsub = subscribe((ev) => {
        if (modeFilter && ev.mode !== modeFilter) return;
        send(ev, "request");
      });

      const abort = c.req.raw.signal;
      if (abort) {
        abort.addEventListener("abort", () => {
          unsub();
          clearInterval(keepAlive);
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>proxy — live</title>
<link rel="preconnect" href="https://api.fontshare.com" crossorigin />
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&f[]=jetbrains-mono@400,500&display=swap" />
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f6f3;
    --panel: #fafaf8;
    --ink: #111111;
    --muted: #6b6b68;
    --line: #eaeaea;
    --accent: #b4543a;
    --red: #b4543a;
    --yellow: #c29a2a;
    --green: #5c7a4a;
    --peak: #3a5c7a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111111;
      --panel: #181816;
      --ink: #ededea;
      --muted: #8a8a86;
      --line: #242422;
      --accent: #d9755a;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Satoshi", ui-sans-serif, sans-serif; -webkit-font-smoothing: antialiased; }
  body { padding: 48px 32px 96px; max-width: 1040px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 32px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-weight: 500; font-size: 22px; letter-spacing: -0.01em; }
  h1 span { color: var(--muted); font-weight: 400; }
  .state { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 10px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .dot.live { background: var(--green); }
  .filter { margin: 32px 0 16px; display: flex; gap: 8px; flex-wrap: wrap; }
  .filter button {
    font-family: "JetBrains Mono", monospace; font-size: 11px; letter-spacing: 0.04em;
    padding: 8px 14px; border: 1px solid var(--line); background: transparent; color: var(--ink);
    border-radius: 8px; cursor: pointer; text-transform: uppercase;
    transition: background-color 200ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .filter button:hover { border-color: var(--ink); }
  .filter button.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .feed { list-style: none; padding: 0; margin: 0; }
  .row {
    display: grid; grid-template-columns: 72px 80px 1fr 200px 80px 72px; gap: 16px; align-items: center;
    padding: 18px 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel);
    margin-bottom: 10px;
    animation: slide 500ms cubic-bezier(0.16, 1, 0.3, 1);
    transition: box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .row:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04); }
  @keyframes slide {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ts, .latency-n, .cost, .model { font-family: "JetBrains Mono", monospace; font-size: 12px; }
  .ts { color: var(--muted); }
  .mode { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; font-family: "JetBrains Mono", monospace; font-weight: 500; }
  .mode[data-mode="red"] { color: var(--red); }
  .mode[data-mode="yellow"] { color: var(--yellow); }
  .mode[data-mode="green"] { color: var(--green); }
  .mode[data-mode="peak"] { color: var(--peak); }
  .path { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .path strong { color: var(--ink); font-weight: 500; }
  .bar { height: 4px; background: var(--line); border-radius: 2px; position: relative; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  .cost { text-align: right; color: var(--muted); }
  .model { text-align: right; color: var(--muted); font-size: 10px; }
  .empty { color: var(--muted); padding: 48px 0; text-align: center; font-size: 13px; }
  footer { color: var(--muted); font-size: 11px; font-family: "JetBrains Mono", monospace; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--line); letter-spacing: 0.04em; }
</style>
</head>
<body>
<header>
  <h1>proxy <span>— live stream</span></h1>
  <div class="state"><span id="dot" class="dot"></span><span id="status">connecting</span></div>
</header>
<div class="filter" id="filter">
  <button data-mode="" class="active">all</button>
  <button data-mode="red">red</button>
  <button data-mode="yellow">yellow</button>
  <button data-mode="green">green</button>
  <button data-mode="peak">peak</button>
</div>
<ul class="feed" id="feed"></ul>
<div class="empty" id="empty">waiting for first request…</div>
<footer>reconnects on error — last 200 events in ring — privacy: no prompts, no completions</footer>
<script>
  (function () {
    const feed = document.getElementById("feed");
    const empty = document.getElementById("empty");
    const dot = document.getElementById("dot");
    const statusEl = document.getElementById("status");
    let activeMode = "";
    let es = null;
    let maxLatency = 500;

    function fmtTs(iso) {
      const d = new Date(iso);
      return d.toLocaleTimeString("en-GB", { hour12: false });
    }
    function fmtCost(c) {
      if (c < 0.001) return "<$0.001";
      return "$" + c.toFixed(4);
    }
    function fmtPath(path) {
      if (!path || !path.length) return "";
      const tail = path[path.length - 1];
      const head = path.slice(0, -1).join(" › ");
      return head ? head + " › <strong>" + tail + "</strong>" : "<strong>" + tail + "</strong>";
    }

    function render(ev) {
      if (activeMode && ev.mode !== activeMode) return;
      empty.style.display = "none";
      const li = document.createElement("li");
      li.className = "row";
      li.dataset.mode = ev.mode;
      if (ev.latency_ms > maxLatency) maxLatency = ev.latency_ms;
      const pct = Math.min(100, (ev.latency_ms / maxLatency) * 100);
      li.innerHTML =
        '<span class="ts">' + fmtTs(ev.ts) + "</span>" +
        '<span class="mode" data-mode="' + ev.mode + '">' + ev.mode + "</span>" +
        '<span class="path">' + fmtPath(ev.path) + "</span>" +
        '<span class="bar"><span style="width:' + pct + '%"></span></span>' +
        '<span class="latency-n">' + ev.latency_ms + "ms</span>" +
        '<span class="cost">' + fmtCost(ev.estimated_cost_usd) + "</span>";
      feed.prepend(li);
      while (feed.children.length > 80) feed.removeChild(feed.lastChild);
    }

    function connect() {
      const url = "/stream" + (activeMode ? "?mode=" + activeMode : "");
      es = new EventSource(url);
      es.addEventListener("hello", () => {
        dot.classList.add("live");
        statusEl.textContent = "live";
      });
      es.addEventListener("request", (e) => {
        try { render(JSON.parse(e.data)); } catch (_) {}
      });
      es.onerror = () => {
        dot.classList.remove("live");
        statusEl.textContent = "reconnecting…";
        es.close();
        setTimeout(connect, 1500);
      };
    }

    document.getElementById("filter").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      activeMode = btn.dataset.mode;
      document.querySelectorAll("#filter button").forEach((b) => b.classList.toggle("active", b === btn));
      feed.innerHTML = "";
      empty.style.display = "block";
      if (es) es.close();
      connect();
    });

    connect();
  })();
</script>
</body>
</html>`;

export function handleStreamView(c: Context): Response {
  return c.html(VIEWER_HTML);
}
