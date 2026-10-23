import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { getSettings } from "@/lib/localDb";
import { extractApiKey, isValidApiKey, getProviderCredentials, markAccountUnavailable, clearAccountError } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";

const URL = "https://chatgpt.com/backend-api/pronunciation/synthesize?format=mp3";
const MAX_TEXT = 4000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
let active = 0;
class SpeechError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fail(status, message) { throw new SpeechError(status, message); }
function responseError(status, message) { return Response.json({ error: { message, type: status < 500 ? "invalid_request_error" : "server_error" } }, { status, headers }); }
function accountId(credentials) {
  const data = credentials?._connection?.providerSpecificData || credentials?.providerSpecificData || {};
  return data.workspaceId || data.chatgptAccountId || data.accountId;
}
function validateCredentials(credentials) {
  if (!credentials || credentials.authType !== "oauth" || typeof credentials.accessToken !== "string"
      || !/^[\x21-\x7e]+$/.test(credentials.accessToken) || typeof accountId(credentials) !== "string"
      || !/^[\x21-\x7e]{1,256}$/.test(accountId(credentials))) fail(503, "A valid Codex OAuth account is required");
}
function decodeAudio(base64, contentType) {
  if (typeof base64 !== "string" || !base64.length || base64.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0
      || typeof contentType !== "string" || !/^audio\/(mpeg|mp3)$/.test(contentType)) throw new Error("Invalid Codex speech response");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES || bytes.toString("base64") !== base64) throw new Error("Invalid Codex speech response");
  return bytes;
}
async function boundedRefresh(credentials, signal, options) {
  let timer; let onAbort;
  try {
    return await Promise.race([
      options ? checkAndRefreshToken("codex", credentials, options) : checkAndRefreshToken("codex", credentials),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SpeechError(504, "Codex OAuth refresh timed out")), 15000);
        onAbort = () => reject(new SpeechError(504, "Codex speech request timed out"));
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener("abort", onAbort); }
}
async function send(credentials, body, signal) {
  const proxy = await resolveConnectionProxyConfig(credentials._connection?.providerSpecificData || credentials.providerSpecificData);
  if (proxy.source === "error") fail(503, "Account proxy is unavailable");
  const proxyConfigured = proxy.vercelRelayUrl || proxy.connectionProxyEnabled || proxy.enabled || proxy.proxyPoolId || proxy.connectionProxyUrl || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  const options = {
    method: "POST", redirect: "error", signal,
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "ChatGPT-Account-Id": accountId(credentials), "Content-Type": "application/json", "User-Agent": "codex_cli_rs/0.0.0 (Linux; x86_64)" },
    body: JSON.stringify(body),
  };
  return proxyConfigured ? proxyAwareFetch(URL, options, proxy) : fetch(URL, options);
}
export async function synthesizeCodexSpeech({ credentials, text, language, speed = 1, signal }) {
  validateCredentials(credentials);
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) fail(400, `input must be 1-${MAX_TEXT} characters`);
  if (typeof language !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) fail(400, "pronunciation_language must be a language tag");
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.5 || speed > 2) fail(400, "speed must be between 0.5 and 2");
  let current = await boundedRefresh(credentials, signal);
  validateCredentials(current);
  const requestBody = { pronunciation_language: language, speed, text };
  let upstream = await send(current, requestBody, signal);
  if (upstream.status === 401 && current.refreshToken) {
    await upstream.body?.cancel();
    const previous = current.accessToken;
    current = await boundedRefresh(current, signal, { force: true });
    validateCredentials(current);
    if (current.accessToken === previous) fail(502, "Codex OAuth refresh failed");
    upstream = await send(current, requestBody, signal);
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    if (upstream.status !== 503) await markAccountUnavailable(current.connectionId, upstream.status, "Codex speech synthesis failed", "codex", "speak");
    fail(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? "Codex speech is rate limited" : "Codex speech synthesis failed");
  }
  const length = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(length) && length > 1024 * 1024) fail(502, "Codex speech response is too large");
  const payload = await upstream.json();
  const bytes = decodeAudio(payload?.base64, payload?.contentType);
  await clearAccountError(current.connectionId, current, "speak");
  return { bytes, contentType: payload.contentType };
}
export async function handleCodexSpeech(request) {
  let slot = false;
  try {
    const settings = await getSettings();
    const key = extractApiKey(request);
    if (settings.requireApiKey && (!key || !await isValidApiKey(key))) return responseError(401, "Valid API key required");
    if (active >= 2) return responseError(503, "Speech capacity reached");
    active++; slot = true;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) fail(400, "Expected application/json");
    const raw = await request.text();
    if (raw.length > 32768) fail(413, "Request body exceeds size limit");
    let body;
    try { body = JSON.parse(raw); } catch { fail(400, "Invalid JSON request body"); }
    for (const key of Object.keys(body || {})) if (!["model", "input", "voice", "response_format", "speed", "pronunciation_language"].includes(key)) fail(400, "Unsupported field");
    if (!body || !["cx/speak", "codex/speak"].includes(body.model)) fail(400, "Use model cx/speak");
    if (body.voice != null && body.voice !== "alloy") fail(400, "Codex Read Aloud does not support voice selection");
    if (body.response_format != null && body.response_format !== "mp3") fail(400, "Only mp3 response_format is supported");
    const credentials = await getProviderCredentials("codex", null, "speak");
    if (credentials?.allRateLimited) fail(429, "Codex speech is rate limited");
    const audio = await synthesizeCodexSpeech({ credentials, text: body.input, language: body.pronunciation_language || "en-US", speed: body.speed ?? 1, signal });
    return new Response(audio.bytes, { headers: { ...headers, "Content-Type": audio.contentType, "Content-Length": String(audio.bytes.length) } });
  } catch (error) {
    const status = error instanceof SpeechError ? error.status : error.name === "AbortError" || error.name === "TimeoutError" ? 504 : 502;
    return responseError(status, error instanceof SpeechError ? error.message : "Codex speech synthesis failed");
  } finally { if (slot) active--; }
}
