import pkg from "../../../package.json" with { type: "json" };

// All limits and upstream constants for the voice call endpoint live here.
export const VOICE_SCOPE = "voice";
export const CODEX_PROVIDER = "codex";
export const VOICE_MODELS = new Set(["cx/voice", "codex/voice"]);
export const UPSTREAM_MODEL = "gpt-live-1.1-codex";
export const DEFAULT_VOICE = "cove";
export const VOICE_PATTERN = /^[a-z]{2,32}$/;
export const DEFAULT_INSTRUCTIONS = "You are a helpful voice assistant.";

export const CREATE_URL = "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas";
export const HANGUP_URL_BASE = "wss://api.openai.com/v1/live/";
export const USER_AGENT = `9router/${pkg.version || "0.0.0"}`;

export const MAX_CONCURRENT_CALLS = 2;
export const CALL_LIMIT_MS = 300_000;
export const HANGUP_ATTEMPTS = 3;
export const HANGUP_RETRY_MS = 2_000;
export const HANGUP_TIMEOUT_MS = 8_000;
export const CREATE_TIMEOUT_MS = 30_000;
export const REFRESH_TIMEOUT_MS = 15_000;
export const BODY_TIMEOUT_MS = 15_000;

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_ANSWER_BYTES = 256 * 1024;
export const MAX_ERROR_BYTES = 8 * 1024;
export const MAX_INSTRUCTIONS_CHARS = 16_000;
export const MAX_CONTEXT_ITEMS = 50;
export const MAX_CONTEXT_CHARS = 16_000;

export const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
