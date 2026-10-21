import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import https from "node:https";
import { Readable } from "node:stream";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { getSettings } from "@/lib/localDb";
import { extractApiKey, isValidApiKey, getProviderCredentials, clearAccountError, markAccountUnavailable } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;
const MAX_PCM_BYTES = MAX_AUDIO_SECONDS * 24000 * 2;
const UPSTREAM = "https://chatgpt.com/backend-api/transcribe";
const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
let active = 0;
class TranscriptionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function failure(status, message) {
  return new TranscriptionError(status, message);
}
function errorResponse(status, message) {
  return Response.json({ error: { message, type: status < 500 ? "invalid_request_error" : "server_error" } }, { status, headers });
}

// Bound bytes while reading, including chunked requests (Content-Length is not trusted).
async function readBounded(stream, limit, signal, oversizedStatus = 413) {
  if (!stream) throw failure(400, "Missing request body");
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw failure(oversizedStatus, "Body exceeds size limit");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function convertAudio(file, signal) {
  const directory = await mkdtemp(join(tmpdir(), "9router-codex-stt-"));
  try {
    const input = join(directory, "input");
    await writeFile(input, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const pcm = await new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1",
        "-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,mov,matroska,webm,ogg,flac,aac",
        "-i", input, "-map", "0:a:0", "-vn", "-t", String(MAX_AUDIO_SECONDS + 0.01),
        "-threads", "1", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
      ], { stdio: ["ignore", "pipe", "ignore"], signal, timeout: 15000, killSignal: "SIGKILL" });
      const chunks = [];
      let size = 0;
      let tooLong = false;
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_PCM_BYTES) { tooLong = true; child.kill("SIGKILL"); }
        else chunks.push(chunk);
      });
      child.on("error", (error) => reject(failure(error.code === "ENOENT" ? 503 : 504, error.code === "ENOENT" ? "ffmpeg is required for transcription" : "Audio conversion timed out")));
      child.on("close", (code) => {
        if (tooLong) reject(failure(400, `Audio duration exceeds ${MAX_AUDIO_SECONDS} seconds`));
        else if (code !== 0 || size === 0) reject(failure(400, "Invalid or unsupported audio"));
        else resolve(Buffer.concat(chunks, size));
      });
    });
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
    return new Blob([wav], { type: "audio/wav" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function boundedRefresh(credentials, signal, options) {
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      options ? checkAndRefreshToken("codex", credentials, options) : checkAndRefreshToken("codex", credentials),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure(504, "Codex OAuth refresh timed out")), 15000);
        onAbort = () => reject(failure(504, "Codex transcription timed out"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
function accountId(credentials) {
  const data = credentials?.providerSpecificData || {};
  return data.workspaceId || data.chatgptAccountId || data.accountId;
}
function validateCredentials(credentials) {
  if (!credentials || credentials.authType !== "oauth" || typeof credentials.accessToken !== "string" || !/^[\x21-\x7e]+$/.test(credentials.accessToken)
      || typeof accountId(credentials) !== "string" || !/^[\x21-\x7e]{1,256}$/.test(accountId(credentials))) {
    throw failure(503, "A valid Codex OAuth account is required");
  }
}
async function send(audio, credentials, signal) {
  const form = new FormData();
  form.set("file", audio, "audio.wav");
  const proxy = await resolveConnectionProxyConfig(credentials._connection?.providerSpecificData || credentials.providerSpecificData);
  if (proxy.source === "error") throw failure(503, "Account proxy is unavailable");
  const boundary = `----9router-codex-${crypto.randomUUID()}`;
  const parts = [];
  for (const [name, value] of form) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${value.type || "application/octet-stream"}\r\n\r\n`));
    parts.push(Buffer.from(await value.arrayBuffer()));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const url = new URL(UPSTREAM);
  const headers = {
    Authorization: `Bearer ${credentials.accessToken}`, "ChatGPT-Account-Id": accountId(credentials),
    "User-Agent": "codex_cli_rs/0.0.0 (Linux; x86_64)",
    "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length),
  };
  const proxyConfigured = proxy.vercelRelayUrl || proxy.connectionProxyEnabled || proxy.enabled || proxy.proxyPoolId || proxy.connectionProxyUrl || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (proxyConfigured) {
    // Keep the shared transport's established proxy, strict-proxy and relay behavior.
    return proxyAwareFetch(UPSTREAM, {
      method: "POST", redirect: "error", signal, body: new Blob([body], { type: headers["Content-Type"] }),
      headers: { Authorization: headers.Authorization, "ChatGPT-Account-Id": headers["ChatGPT-Account-Id"], "User-Agent": headers["User-Agent"] },
    }, proxy);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", headers, signal }, (res) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value != null) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, String(item)));
        else responseHeaders.set(key, String(value));
      }
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode || 502, statusText: res.statusMessage || "", headers: responseHeaders }));
    });
    req.once("error", reject);
    req.end(body);
  });
}

export async function handleCodexTranscription(request) {
  let slot = false;
  try {
    const settings = await getSettings();
    const key = extractApiKey(request);
    if (settings.requireApiKey && (!key || !await isValidApiKey(key))) return errorResponse(401, "Valid API key required");
    if (active >= 2) return errorResponse(503, "Transcription capacity reached");
    active++; slot = true;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
    const contentType = request.headers.get("content-type") || "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) throw failure(400, "Expected multipart form data");
    const bytes = await readBounded(request.body, MAX_AUDIO_BYTES + 65536, AbortSignal.any([signal, AbortSignal.timeout(15000)]));
    let form;
    try { form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
    catch { throw failure(400, "Invalid multipart form data"); }
    for (const [key] of form) {
      if (!["model", "file", "response_format", "language", "prompt", "temperature"].includes(key) || form.getAll(key).length !== 1) throw failure(400, "Unsupported or duplicate form field");
    }
    if (!["cx/transcribe", "codex/transcribe"].includes(form.get("model"))) throw failure(400, "Use model cx/transcribe");
    const format = form.get("response_format") || "json";
    if (!["json", "text"].includes(format)) throw failure(400, "Only json and text response formats are supported");
    for (const key of ["language", "prompt", "temperature"]) {
      if (form.has(key) && form.get(key) !== "") throw failure(400, `${key} is not supported by Codex transcription`);
    }
    const file = form.get("file");
    if (!(file instanceof Blob) || !file.size) throw failure(400, "A non-empty audio file is required");
    if (file.size > MAX_AUDIO_BYTES) throw failure(413, "Audio exceeds 25 MiB");
    if (!/^(audio\/(wav|x-wav|wave|mpeg|mp3|mp4|m4a|x-m4a|ogg|flac|x-flac|webm|aac|opus)|video\/(mp4|webm)|application\/octet-stream)$/.test(file.type)) throw failure(400, "Unsupported audio type");
    let credentials = await getProviderCredentials("codex", null, "transcribe");
    if (credentials?.allRateLimited) return errorResponse(429, "Codex transcription is rate limited");
    validateCredentials(credentials);
    credentials = await boundedRefresh(credentials, signal);
    validateCredentials(credentials);
    const audio = await convertAudio(file, signal);
    let response = await send(audio, credentials, signal);
    if (response.status === 401 && credentials.refreshToken) {
      await response.body?.cancel();
      const previous = credentials.accessToken;
      credentials = await boundedRefresh(credentials, signal, { force: true });
      validateCredentials(credentials);
      if (credentials.accessToken === previous) throw failure(502, "Codex OAuth refresh failed");
      response = await send(audio, credentials, signal);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status === 429 ? 429 : response.status === 401 ? 502 : 502;
      await markAccountUnavailable(credentials.connectionId, response.status, "Codex transcription failed", "codex", "transcribe");
      return errorResponse(status, status === 429 ? "Codex transcription is rate limited" : "Codex transcription failed");
    }
    const result = await readBounded(response.body, 1024 * 1024, signal, 502);
    let data;
    try { data = JSON.parse(result.toString("utf8")); } catch { throw failure(502, "Invalid transcription response"); }
    if (!data || typeof data.text !== "string" || data.text.length > 250000) throw failure(502, "Invalid transcription response");
    await clearAccountError(credentials.connectionId, credentials, "transcribe");
    return format === "text" ? new Response(data.text, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } }) : Response.json({ text: data.text }, { headers });
  } catch (error) {
    return errorResponse(error instanceof TranscriptionError ? error.status : (error.name === "AbortError" || error.name === "TimeoutError" ? 504 : 502), error instanceof TranscriptionError ? error.message : "Codex transcription failed");
  } finally {
    if (slot) active--;
  }
}
