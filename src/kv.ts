import { Redis } from "@upstash/redis";
import type { BiometricState } from "./types.js";

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required",
      );
    }
    client = new Redis({ url, token });
  }
  return client;
}

export const kv = {
  async getBiometricState(): Promise<BiometricState | null> {
    const data = await getClient().get<BiometricState>("biometric:state");
    return data ?? null;
  },

  async setBiometricState(state: BiometricState): Promise<void> {
    await getClient().set("biometric:state", state);
  },

  async getRefreshToken(): Promise<string | null> {
    const token = await getClient().get<string>("whoop:refresh_token");
    return token ?? null;
  },

  async setRefreshToken(token: string): Promise<void> {
    await getClient().set("whoop:refresh_token", token);
  },
};
