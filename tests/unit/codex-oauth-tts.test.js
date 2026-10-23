import { afterEach, beforeEach, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  getSettings: vi.fn(), extractApiKey: vi.fn(), isValidApiKey: vi.fn(), getProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(), markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(), proxyAwareFetch: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: deps.getSettings }));
vi.mock("@/sse/services/auth.js", () => ({ ...deps }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: deps.checkAndRefreshToken }));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: deps.resolveConnectionProxyConfig }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: deps.proxyAwareFetch }));
let POST;
const credentials = { connectionId: "test-connection", authType: "oauth", accessToken: "test-access", refreshToken: "test-refresh", providerSpecificData: { workspaceId: "test-workspace" } };
function request(body = {}, headers = { authorization: "Bearer client-key" }) {
  return new Request("http://localhost/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ model: "cx/speak", input: "Hello", ...body }) });
}
beforeEach(async () => {
  vi.clearAllMocks();
  deps.getSettings.mockResolvedValue({ requireApiKey: true });
  deps.extractApiKey.mockReturnValue("client-key");
  deps.isValidApiKey.mockResolvedValue(true);
  deps.getProviderCredentials.mockResolvedValue(credentials);
  deps.checkAndRefreshToken.mockImplementation(async (_provider, current) => current);
  deps.resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: true });
  deps.proxyAwareFetch.mockResolvedValue(Response.json({ base64: Buffer.from("ID3mock-audio").toString("base64"), contentType: "audio/mpeg" }));
  ({ POST } = await import("../../src/app/api/v1/audio/speech/route.js"));
});
afterEach(() => vi.unstubAllGlobals());

it("routes authenticated requests through Codex OAuth with the SDK-shaped payload", async () => {
  const response = await POST(request({ pronunciation_language: "en-US", speed: 1.25 }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("audio/mpeg");
  expect(Buffer.from(await response.arrayBuffer()).subarray(0, 3).toString()).toBe("ID3");
  expect(deps.getProviderCredentials).toHaveBeenCalledWith("codex", null, "speak");
  expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
  const [url, init] = deps.proxyAwareFetch.mock.calls[0];
  expect(url).toBe("https://chatgpt.com/backend-api/pronunciation/synthesize?format=mp3");
  expect(init.headers).toMatchObject({ Authorization: "Bearer test-access", "ChatGPT-Account-Id": "test-workspace" });
  expect(JSON.parse(init.body)).toEqual({ pronunciation_language: "en-US", speed: 1.25, text: "Hello" });
});

it("rejects bad client keys and invalid fields before upstream calls", async () => {
  deps.isValidApiKey.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(401);
  deps.isValidApiKey.mockResolvedValue(true);
  expect((await POST(request({ voice: "arbitrary" }))).status).toBe(400);
  expect((await POST(request({ input: "" }))).status).toBe(400);
  expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
});

it("retries one 401 only after a changed persisted OAuth token", async () => {
  deps.checkAndRefreshToken.mockImplementation(async (_provider, current, options) => options?.force ? { ...current, accessToken: "test-new-access" } : current);
  deps.proxyAwareFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 })).mockResolvedValueOnce(Response.json({ base64: Buffer.from("ID3ok").toString("base64"), contentType: "audio/mpeg" }));
  expect((await POST(request())).status).toBe(200);
  expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(2);
  expect(deps.proxyAwareFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer test-new-access");
});

it.each([429, 500, 503])("sanitizes upstream %s and preserves 503 cooldown semantics", async (status) => {
  deps.proxyAwareFetch.mockResolvedValue(new Response("test-access secret", { status }));
  const response = await POST(request());
  expect(response.status).toBe(status === 429 ? 429 : 502);
  expect(await response.text()).not.toContain("test-access");
  if (status === 503) expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  else expect(deps.markAccountUnavailable).toHaveBeenCalledWith("test-connection", status, "Codex speech synthesis failed", "codex", "speak");
});

it("rejects malformed base64, non-audio content types, and oversized audio", async () => {
  for (const payload of [
    { base64: "%%%", contentType: "audio/mpeg" },
    { base64: Buffer.from("ID3").toString("base64"), contentType: "text/html" },
    { base64: Buffer.alloc(16 * 1024 * 1024).toString("base64"), contentType: "audio/mpeg" },
  ]) {
    deps.proxyAwareFetch.mockResolvedValueOnce(Response.json(payload));
    expect((await POST(request())).status).toBe(502);
  }
});
