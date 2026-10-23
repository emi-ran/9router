import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

const deps = vi.hoisted(() => ({
  getSettings: vi.fn(), isValidApiKey: vi.fn(), getProviderCredentials: vi.fn(),
  clearAccountError: vi.fn(), markAccountUnavailable: vi.fn(), checkAndRefreshToken: vi.fn(),
  proxyAwareFetch: vi.fn(), resolveConnectionProxyConfig: vi.fn(), httpsRequest: vi.fn(),
}));
vi.mock("node:https", () => ({ default: { request: deps.httpsRequest } }));
function directHttps(response = Response.json({ text: "Merhaba", asset_pointer: "never-return-this" })) {
  deps.resolveConnectionProxyConfig.mockResolvedValue({});
  deps.httpsRequest.mockImplementation((_url, options, callback) => {
    const req = new EventEmitter();
    req.end = (body) => {
      const nodeResponse = Readable.fromWeb(response.body);
      nodeResponse.headers = Object.fromEntries(response.headers.entries());
      nodeResponse.statusCode = response.status; nodeResponse.statusMessage = response.statusText;
      callback(nodeResponse);
      req.options = options; req.body = body;
    };
    return req;
  });
}
vi.mock("@/lib/localDb", () => ({ getSettings: deps.getSettings }));
vi.mock("@/sse/services/auth.js", () => ({
  ...deps, extractApiKey: (request) => request.headers.get("authorization")?.replace(/^Bearer /, "") || request.headers.get("x-api-key"),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: deps.checkAndRefreshToken }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: deps.proxyAwareFetch }));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: deps.resolveConnectionProxyConfig }));

// PCM16 mono WAV: exercise the actual converter, not a stubbed transport.
function wav(seconds = 0.1) {
  const samples = Math.ceil(24000 * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
function request(fields = {}, file = new Blob([wav()], { type: "audio/wav" }), headers = {}) {
  const form = new FormData();
  form.set("model", "cx/transcribe"); form.set("file", file, "input.wav");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers, body: form });
}
let POST;
beforeEach(async () => {
  vi.clearAllMocks();
  deps.getSettings.mockResolvedValue({ requireApiKey: true });
  deps.isValidApiKey.mockResolvedValue(true);
  deps.getProviderCredentials.mockResolvedValue({ connectionId: "test-connection", authType: "oauth", accessToken: "test-access", refreshToken: "test-refresh", providerSpecificData: { workspaceId: "workspace", baseUrl: "http://attacker.invalid" } });
  deps.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
  deps.resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080", strictProxy: true });
  deps.proxyAwareFetch.mockResolvedValue(Response.json({ text: "Merhaba", asset_pointer: "never-return-this" }));
  ({ POST } = await import("../../src/app/api/v1/audio/transcriptions/route.js"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("times out while waiting for persisted token refresh", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let entered;
    const ready = new Promise((resolve) => { entered = resolve; });
    deps.checkAndRefreshToken.mockImplementation(() => { entered(); return new Promise(() => {}); });
    const responsePromise = POST(authorized());
    await ready;
    await vi.advanceTimersByTimeAsync(16000);
    const response = await responsePromise;
    expect(response.status).toBe(504);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
}, 2000);
it("reports missing ffmpeg without leaking host errors or temporary files", async () => {
  vi.stubEnv("PATH", "/nonexistent");
  const response = await POST(authorized());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("ENOENT");
});
it("retries 401 only once even when refreshed token also fails", async () => {
  deps.checkAndRefreshToken.mockImplementation(async (_provider, credentials, options) => options?.force ? { ...credentials, accessToken: "test-new-access" } : credentials);
  deps.proxyAwareFetch.mockImplementation(async () => new Response("secret", { status: 401 }));
  expect((await POST(authorized())).status).toBe(502);
  expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(2);
});
it("rejects malformed refreshed credentials before sending OAuth", async () => {
  deps.checkAndRefreshToken.mockResolvedValue({ accessToken: "bad\r\nsecret" });
  expect((await POST(authorized())).status).toBe(503);
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});

const authorized = (fields = {}, file) => request(fields, file, { authorization: "Bearer test-client-key" });
it("rejects missing or invalid required keys before reading multipart or selecting accounts", async () => {
  expect((await POST(request())).status).toBe(401);
  deps.isValidApiKey.mockResolvedValue(false);
  expect((await POST(authorized())).status).toBe(401);
  expect(deps.getProviderCredentials).not.toHaveBeenCalled();
});
it.each(["openai/whisper-1", "kiro/transcribe", "cx/whisper-1", "http://attacker.invalid"])("rejects non-Codex model %s without upstream calls", async (model) => {
  expect((await POST(authorized({ model }))).status).toBe(400);
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it.each(["verbose_json", "srt", "vtt", "binary"])("rejects unsupported response format %s", async (response_format) => {
  expect((await POST(authorized({ response_format }))).status).toBe(400);
});
it.each(["prompt", "language", "temperature", "baseUrl"])("rejects unsupported input %s", async (key) => {
  expect((await POST(authorized({ [key]: "value" }))).status).toBe(400);
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it("returns text format with no asset metadata", async () => {
  const response = await POST(authorized({ response_format: "text", model: "codex/transcribe" }));
  expect(response.headers.get("content-type")).toContain("text/plain");
  expect(await response.text()).toBe("Merhaba");
});
it("rejects a string instead of file", async () => {
  const form = new FormData(); form.set("model", "cx/transcribe"); form.set("file", "http://attacker.invalid");
  expect((await POST(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer test" }, body: form }))).status).toBe(400);
});
it("rejects empty, invalid audio and unsupported MIME", async () => {
  for (const file of [new Blob([], { type: "audio/wav" }), new Blob(["garbage"], { type: "audio/wav" }), new Blob([wav()], { type: "text/plain" })]) {
    expect((await POST(authorized({}, file))).status).toBe(400);
  }
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it("converts real compressed MP3 and WebM audio to 24 kHz PCM WAV", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const [format, codec, type] of [["mp3", "libmp3lame", "audio/mpeg"], ["webm", "libopus", "audio/webm"]]) {
    const fixture = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "wav", "-i", "pipe:0", "-threads", "1", "-c:a", codec, "-f", format, "pipe:1"], { input: wav(), timeout: 5000, maxBuffer: 1024 * 1024 });
    expect(fixture.status).toBe(0);
    deps.proxyAwareFetch.mockResolvedValueOnce(Response.json({ text: format }));
    const response = await POST(authorized({}, new Blob([fixture.stdout], { type })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: format });
  }
});
it("rejects duplicate multipart fields", async () => {
  const form = new FormData(); form.append("model", "cx/transcribe"); form.append("model", "cx/transcribe"); form.append("file", new Blob([wav()], { type: "audio/wav" }), "audio.wav");
  const response = await POST(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: form, headers: { authorization: "Bearer test" } }));
  expect(response.status).toBe(400); expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it("rejects a file over 25 MiB even within multipart overhead allowance", async () => {
  expect((await POST(authorized({}, new Blob([new Uint8Array(25 * 1024 * 1024 + 1)], { type: "audio/wav" })))).status).toBe(413);
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it("bounds chunked body size without trusting Content-Length", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(26 * 1024 * 1024)); controller.close(); } });
  const response = await POST(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body, duplex: "half", headers: { authorization: "Bearer test", "content-type": "multipart/form-data; boundary=test", "content-length": "1" } }));
  expect(response.status).toBe(413); expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it("rejects duration over 120 seconds instead of silently truncating", async () => {
  expect((await POST(authorized({}, new Blob([wav(120.1)], { type: "audio/wav" })))).status).toBe(400);
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it.each([{ authType: "apikey", apiKey: "test-api" }, { authType: "oauth", accessToken: "test-access" }])("rejects invalid OAuth credentials", async (credentials) => {
  deps.getProviderCredentials.mockResolvedValue(credentials);
  expect((await POST(authorized())).status).toBe(503);
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
it("forces one persisted refresh after 401 and retries with the updated token", async () => {
  deps.checkAndRefreshToken.mockImplementation(async (_provider, credentials, options) => options?.force ? { ...credentials, accessToken: "test-new-access" } : credentials);
  deps.proxyAwareFetch.mockResolvedValueOnce(new Response("secret upstream body", { status: 401 })).mockResolvedValueOnce(Response.json({ text: "retry ok", asset_pointer: "secret" }));
  const response = await POST(authorized());
  expect(await response.json()).toEqual({ text: "retry ok" });
  expect(deps.checkAndRefreshToken).toHaveBeenLastCalledWith("codex", expect.any(Object), { force: true });
  expect(deps.proxyAwareFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer test-new-access");
});
it("does not retry when refresh returns unchanged or malformed credentials", async () => {
  deps.proxyAwareFetch.mockResolvedValue(new Response("test-access asset_pointer secret", { status: 401 }));
  const response = await POST(authorized());
  expect(response.status).toBe(502); expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
  expect(await response.text()).not.toContain("test-access");
});
it.each([429, 500, 503])("sanitizes upstream %s and only locks the account for account-scoped failures", async (status) => {
  deps.proxyAwareFetch.mockResolvedValue(new Response("test-access asset_pointer secret", { status }));
  const response = await POST(authorized());
  expect(response.status).toBe(status === 429 ? 429 : 502);
  expect(await response.text()).not.toContain("test-access");
  expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
  if (status === 503) expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  else expect(deps.markAccountUnavailable).toHaveBeenCalledWith("test-connection", status, "Codex transcription failed", "codex", "transcribe");
});
it.each([{ text: 123 }, {}, { text: null }])("rejects malformed upstream JSON", async (data) => {
  deps.proxyAwareFetch.mockResolvedValue(Response.json(data));
  expect((await POST(authorized())).status).toBe(502);
});
it("cleans conversion temp directories on success and malformed audio", async () => {
  const { readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const listing = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("9router-codex-stt-")).sort();
  const before = await listing();
  expect((await POST(authorized())).status).toBe(200);
  expect(await listing()).toEqual(before);
  expect((await POST(authorized({}, new Blob(["invalid"], { type: "audio/wav" })))).status).toBe(400);
  expect(await listing()).toEqual(before);
});
it("bounds upstream response size as an upstream error", async () => {
  deps.proxyAwareFetch.mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1)));
  expect((await POST(authorized())).status).toBe(502);
});
it("sanitizes transport exceptions", async () => {
  deps.proxyAwareFetch.mockRejectedValue(new Error("test-access test-refresh secret"));
  const response = await POST(authorized());
  expect(response.status).toBe(502); expect(await response.text()).not.toContain("test-access");
});
it("sanitizes even errors carrying an attacker-controlled status", async () => {
  deps.proxyAwareFetch.mockRejectedValue(Object.assign(new Error("test-access secret"), { status: 418 }));
  const response = await POST(authorized());
  expect(response.status).toBe(502); expect(await response.text()).not.toContain("test-access");
});


it("routes authenticated multipart through direct HTTPS to fixed OAuth-only Codex upstream", async () => {
  directHttps();
  const response = await POST(request({}, undefined, { authorization: "Bearer test-client-key" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ text: "Merhaba" });
  expect(deps.isValidApiKey).toHaveBeenCalledWith("test-client-key");
  expect(deps.getProviderCredentials).toHaveBeenCalledWith("codex", null, "transcribe");
  expect(deps.checkAndRefreshToken).toHaveBeenCalledWith("codex", expect.objectContaining({ connectionId: "test-connection" }));
  expect(deps.httpsRequest).toHaveBeenCalledTimes(1);
  const [url, options] = deps.httpsRequest.mock.calls[0];
  expect(url.href).toBe("https://chatgpt.com/backend-api/transcribe");
  expect(options.headers).toMatchObject({ Authorization: "Bearer test-access", "ChatGPT-Account-Id": "workspace", "User-Agent": "codex_cli_rs/0.0.0 (Linux; x86_64)" });
  const body = deps.httpsRequest.mock.results[0].value.body;
  expect(body.toString()).toContain('name="file"; filename="audio.wav"');
  expect(body.toString()).toContain("Content-Type: audio/wav");
  expect(body.subarray(body.indexOf(Buffer.from("\r\n\r\n")) + 4, body.indexOf(Buffer.from("\r\n------9router-codex"))).subarray(0, 4).toString()).toBe("RIFF");
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});
