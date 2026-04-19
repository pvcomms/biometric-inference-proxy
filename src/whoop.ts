import type { WhoopTokenResponse, WhoopRecoveryResponse } from "./types.js";
import { kv } from "./kv.js";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const RECOVERY_URL = "https://api.prod.whoop.com/developer/v1/recovery/";

async function getAccessToken(): Promise<string> {
  const storedRefresh =
    (await kv.getRefreshToken()) ?? process.env.WHOOP_REFRESH_TOKEN;

  if (!storedRefresh) {
    throw new Error("No WHOOP refresh token available");
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are required");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: storedRefresh,
    client_id: clientId,
    client_secret: clientSecret,
    scope: "offline read:recovery",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Whoop token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as WhoopTokenResponse;

  await kv.setRefreshToken(data.refresh_token);

  return data.access_token;
}

export async function fetchLatestRecovery(): Promise<{
  recovery_score: number;
  hrv_rmssd: number;
}> {
  const accessToken = await getAccessToken();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    start: yesterday.toISOString(),
    end: now.toISOString(),
    limit: "1",
  });

  const res = await fetch(`${RECOVERY_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Whoop recovery fetch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as WhoopRecoveryResponse;

  if (!data.records || data.records.length === 0) {
    throw new Error("No recovery records returned from Whoop");
  }

  const record = data.records[0];
  return {
    recovery_score: record.score.recovery_score,
    hrv_rmssd: record.score.hrv_rmssd_milli,
  };
}
