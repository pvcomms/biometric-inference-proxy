export type BiometricMode = "red" | "yellow" | "green" | "peak";

export interface InferenceParams {
  temperature: number;
  thinking_tokens: number;
  system_prefix: string;
  max_tokens: number;
  use_thinking: boolean;
}

export interface BiometricState {
  recovery_score: number;
  hrv_rmssd: number;
  mode: BiometricMode;
  updated_at: string;
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  thinking?: {
    type: "enabled";
    budget_tokens: number;
  };
  stream?: boolean;
}

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface WhoopRecoveryRecord {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: string;
  score: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage: number;
    skin_temp_celsius: number;
  };
}

export interface WhoopRecoveryResponse {
  records: WhoopRecoveryRecord[];
  next_token?: string;
}
