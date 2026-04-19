# biometric-inference-proxy

An OpenAI-compatible proxy that sits between any AI client and the Anthropic Claude API. It polls your Whoop recovery score every 10 minutes, stores state in Upstash Redis, and dynamically rewrites inference parameters — temperature, thinking budget, system prompt prefix, and max tokens — based on your physiological state before forwarding requests upstream.

## Architecture

```
AI Client (OpenAI SDK)
        │
        │  POST /v1/chat/completions
        ▼
┌─────────────────────────────────────┐
│       biometric-inference-proxy      │
│                                     │
│  ┌──────────┐    ┌───────────────┐  │
│  │  Whoop   │───▶│  Upstash KV   │  │
│  │  Poller  │    │ biometric:    │  │
│  │ (10 min) │    │   state       │  │
│  └──────────┘    └───────┬───────┘  │
│                          │          │
│  ┌──────────────────────▼───────┐  │
│  │         proxy.ts             │  │
│  │  1. read biometric mode      │  │
│  │  2. condition params         │  │
│  │  3. translate OpenAI→Claude  │  │
│  │  4. inject thinking budget   │  │
│  │  5. stream SSE back          │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
        │
        │  Anthropic Messages API
        ▼
   Claude (claude-sonnet-4-6)
```

## Quick Start

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY, WHOOP_*, UPSTASH_* values

pnpm install
pnpm dev
```

The server starts on `http://localhost:3000`. Point any OpenAI client at it:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: process.env.PROXY_API_KEY ?? "any-string-if-no-key-set",
});

const response = await client.chat.completions.create({
  model: "claude-sonnet-4-6", // or any OpenAI model name — proxy maps it
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});
```

## Deploy Options

### Fly.io (recommended — long-running process with built-in poller)

```bash
fly launch --name biometric-inference-proxy --region sin
fly secrets set ANTHROPIC_API_KEY=... WHOOP_CLIENT_ID=... WHOOP_CLIENT_SECRET=... \
  WHOOP_REFRESH_TOKEN=... UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=...
fly deploy
```

The built-in `setInterval` poller runs continuously. `auto_stop_machines = false` keeps it alive.

### Vercel (serverless — requires external cron)

```bash
vercel --prod
```

`vercel.json` includes a cron at `*/10 * * * *` that hits `POST /poll`. The biometric state lives in Upstash Redis between invocations. Note: streaming works on Vercel Edge Functions but the built-in poller won't run between requests.

## Whoop OAuth Setup

You need a refresh token with `offline read:recovery` scopes. Get one via the PKCE flow:

1. Create an app at [developer.whoop.com](https://developer.whoop.com) — note your `client_id` and `client_secret`.
2. Run the PKCE authorization flow:
   ```
   https://api.prod.whoop.com/oauth/oauth2/auth
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_REDIRECT_URI
     &response_type=code
     &scope=offline%20read:recovery
     &code_challenge=YOUR_CHALLENGE
     &code_challenge_method=S256
   ```
3. Exchange the code for tokens at `POST https://api.prod.whoop.com/oauth/oauth2/token` with `grant_type=authorization_code`.
4. Copy the `refresh_token` from the response into `WHOOP_REFRESH_TOKEN`.

The proxy automatically rotates the refresh token on every poll and persists the new one to Redis (`whoop:refresh_token`).

See: [Whoop Developer Docs — OAuth 2.0](https://developer.whoop.com/api#section/Authentication)

## Biometric Modes

| Mode   | Recovery | Temperature | Thinking Budget | Max Tokens | System Prefix                                                                     |
| ------ | -------- | ----------- | --------------- | ---------- | --------------------------------------------------------------------------------- |
| Red    | < 33%    | 0.3         | 8 192           | 2 048      | Be precise, conservative, concise. No speculation.                                |
| Yellow | 33–65%   | 0.7         | 16 384          | 4 096      | _(none)_                                                                          |
| Green  | 66–84%   | 1.0         | 32 768          | 8 192      | Explore multiple angles. Be thorough.                                             |
| Peak   | 85%+     | 1.2         | 65 536          | 16 384     | Think expansively. Make creative connections. Consider unconventional approaches. |

Temperature is omitted for Green/Peak since Anthropic ignores it when extended thinking is enabled.

Set `FORCE_MODE=red|yellow|green|peak` to bypass Whoop polling (useful for testing).

## API Reference

### POST /v1/chat/completions

Drop-in OpenAI replacement. Accepts the full OpenAI chat completions body.

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is HRV?"}],
    "stream": true
  }'
```

Response is standard OpenAI SSE format: `data: {"choices":[{"delta":{"content":"..."}}]}`

### GET /health

```json
{ "status": "ok" }
```

### GET /status

Returns current biometric state and effective mode.

```json
{
  "biometric": {
    "recovery_score": 72,
    "hrv_rmssd": 68.4,
    "mode": "green",
    "updated_at": "2026-04-19T07:15:00.000Z"
  },
  "force_mode": null,
  "effective_mode": "green"
}
```

### POST /poll

Manually trigger a Whoop poll and KV update. Useful for testing or forcing a refresh.

```bash
curl -X POST http://localhost:3000/poll
```

## Extending

To add Oura, Garmin, or another biometric source:

1. Create `src/oura.ts` mirroring `whoop.ts` — implement `fetchLatestRecovery()` returning `{ recovery_score, hrv_rmssd }`.
2. In `poller.ts`, import your new client and call it based on an env var (`BIOMETRIC_SOURCE=oura|whoop|garmin`).
3. The conditioner and proxy are source-agnostic — they only see `recovery_score` (0–100).

The KV schema (`biometric:state`) is the only contract between the poller and the proxy.
