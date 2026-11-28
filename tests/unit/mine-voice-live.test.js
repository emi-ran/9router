import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  getSettings: vi.fn(), getProviderConnections: vi.fn(),
  extractApiKey: vi.fn(), isValidApiKey: vi.fn(), getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(), checkAndRefreshToken: vi.fn(),
  proxyAwareFetch: vi.fn(), resolveConnectionProxyConfig: vi.fn(),
}));
const socketKit = vi.hoisted(() => {
  const state = { sockets: [], agents: [], replies: [], defaultReply: "closed" };
  class FakeWebSocket {
    constructor(url, init) {
      this.url = url; this.init = init; this.sent = []; this.closed = false; this.listeners = new Map();
      this.reply = state.replies.length ? state.replies.shift() : state.defaultReply;
      state.sockets.push(this);
      queueMicrotask(() => this.dispatch("open", {}));
    }
    addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    dispatch(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
    send(data) {
      this.sent.push(data);
      queueMicrotask(() => {
        if (this.reply === "closed") {
          // Audio-sized event first: the client must ignore it and keep waiting.
          this.dispatch("message", { data: JSON.stringify({ type: "response.audio.delta", delta: "a".repeat(4096) }) });
          this.dispatch("message", { data: JSON.stringify({ type: "session.closed", id: "x" }) });
        } else if (this.reply === "error") {
          this.dispatch("error", {});
        }
        // "silent": never answers, the 8 s hangup timeout must fire.
      });
    }
    close() { this.closed = true; }
  }
  class FakeProxyAgent {
    constructor(options) { this.options = options; this.closed = false; state.agents.push(this); }
    close() { this.closed = true; return Promise.resolve(); }
  }
  return { state, FakeWebSocket, FakeProxyAgent };
});

vi.mock("undici", () => ({ WebSocket: socketKit.FakeWebSocket, ProxyAgent: socketKit.FakeProxyAgent }));
vi.mock("@/lib/localDb", () => ({ getSettings: deps.getSettings, getProviderConnections: deps.getProviderConnections }));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: deps.extractApiKey, isValidApiKey: deps.isValidApiKey, getProviderCredentials: deps.getProviderCredentials,
  markAccountUnavailable: deps.markAccountUnavailable, clearAccountError: deps.clearAccountError,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: deps.checkAndRefreshToken }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: deps.proxyAwareFetch }));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: deps.resolveConnectionProxyConfig }));

import { POST as createCall } from "../../src/app/api/v1/live/route.js";
import * as liveRoute from "../../src/app/api/v1/live/route.js";
import { DELETE as deleteCall } from "../../src/app/api/v1/live/[id]/route.js";
import * as liveIdRoute from "../../src/app/api/v1/live/[id]/route.js";
import { getCall, resetRegistryForTests } from "../../src/mine/voice/registry.js";
import { CALL_LIMIT_MS, HANGUP_ATTEMPTS, HANGUP_RETRY_MS } from "../../src/mine/voice/constants.js";

const KEY = "test-client-key";
const OTHER_KEY = "test-other-key";
const CREATE_URL = "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas";
const SDP_OFFER = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SDP_ANSWER = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const CALL_ID = "rtc_u32_test_call_1";

function account(overrides = {}) {
  const id = overrides.connectionId || "acct-1";
  const workspace = overrides.workspace || "ws-1";
  return {
    connectionId: id, authType: "oauth", accessToken: overrides.accessToken || "tok-1", refreshToken: "ref-1",
    providerSpecificData: { workspaceId: workspace },
    _connection: { id, providerSpecificData: { workspaceId: workspace } },
  };
}
function created(id = CALL_ID, sdp = SDP_ANSWER, status = 201) {
  return new Response(sdp, { status, headers: { location: `/v1/live/${id}` } });
}
function post(body = { sdp: SDP_OFFER }, headers = {}) {
  const init = { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers } };
  init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/v1/live", init);
}
function del(id, key = KEY) {
  return new Request(`http://localhost/v1/live/${id}`, { method: "DELETE", headers: key ? { authorization: `Bearer ${key}` } : {} });
}
const paramsOf = (id) => ({ params: Promise.resolve({ id }) });
async function flush() {
  for (let i = 0; i < 300; i++) await Promise.resolve();
}
async function openOne(body) {
  const response = await createCall(post(body));
  expect(response.status).toBe(201);
  return response.json();
}
function sentPayload(index = 0) {
  return JSON.parse(deps.proxyAwareFetch.mock.calls[index][1].body);
}

beforeEach(() => {
  vi.resetAllMocks();
  resetRegistryForTests();
  socketKit.state.sockets.length = 0;
  socketKit.state.agents.length = 0;
  socketKit.state.replies.length = 0;
  socketKit.state.defaultReply = "closed";
  deps.getSettings.mockResolvedValue({ voiceEnabled: true, requireApiKey: false });
  deps.extractApiKey.mockImplementation((request) => request.headers.get("authorization")?.replace(/^Bearer /, "") || request.headers.get("x-api-key") || null);
  deps.isValidApiKey.mockImplementation(async (key) => key === KEY || key === OTHER_KEY);
  deps.getProviderCredentials.mockResolvedValue(account());
  deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "none", connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", strictProxy: false });
  deps.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
  // First successful create gets CALL_ID; later ones get unique ids (a repeated id is refused).
  let createdCount = 0;
  deps.proxyAwareFetch.mockImplementation(async () => created(createdCount++ === 0 ? CALL_ID : `${CALL_ID}_${createdCount}`));
  deps.getProviderConnections.mockResolvedValue([{ id: "acct-1", authType: "oauth", accessToken: "tok-1", refreshToken: "ref-1", providerSpecificData: { workspaceId: "ws-1" } }]);
  deps.clearAccountError.mockResolvedValue(undefined);
  deps.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 1000 });
  for (const name of ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetRegistryForTests();
});

describe("API key and feature flag", () => {
  it.each([
    ["no key", null],
    ["invalid key", "test-unknown-key"],
  ])("rejects POST with %s before reading the body or touching accounts, even with requireApiKey false", async (_label, key) => {
    deps.getSettings.mockResolvedValue({ voiceEnabled: true, requireApiKey: false });
    deps.isValidApiKey.mockResolvedValue(false);
    const request = post({ sdp: SDP_OFFER }, key ? { authorization: `Bearer ${key}` } : {});
    if (!key) request.headers.delete("authorization");
    const response = await createCall(request);
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(deps.getProviderCredentials).not.toHaveBeenCalled();
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("rejects loopback requests without a key", async () => {
    const request = new Request("http://127.0.0.1:20128/v1/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: SDP_OFFER }) });
    expect((await createCall(request)).status).toBe(401);
    expect(deps.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("returns 401, not 403, when voice is disabled and no key is given", async () => {
    deps.getSettings.mockResolvedValue({ voiceEnabled: false });
    const request = new Request("http://localhost/v1/live", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await createCall(request)).status).toBe(401);
  });

  it("returns 403 when voiceEnabled is off, without touching accounts", async () => {
    deps.getSettings.mockResolvedValue({ voiceEnabled: false, requireApiKey: true });
    const request = post({ sdp: SDP_OFFER });
    const response = await createCall(request);
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(deps.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("rejects DELETE without a valid key and keeps the call", async () => {
    const { id } = await openOne();
    expect((await deleteCall(del(id, null), paramsOf(id))).status).toBe(401);
    expect((await deleteCall(del(id, "test-unknown-key"), paramsOf(id))).status).toBe(401);
    expect(getCall(id)).not.toBeNull();
    expect(socketKit.state.sockets).toHaveLength(0);
  });

  it("lets DELETE work while voiceEnabled is off", async () => {
    const { id } = await openOne();
    deps.getSettings.mockResolvedValue({ voiceEnabled: false });
    const response = await deleteCall(del(id), paramsOf(id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: CALL_ID, status: "closed" });
  });
});

describe("CORS and secrets", () => {
  it("exports no OPTIONS handler on either route", () => {
    expect(liveRoute.OPTIONS).toBeUndefined();
    expect(liveIdRoute.OPTIONS).toBeUndefined();
  });

  it("sends no Access-Control-* headers on any response", async () => {
    const responses = [
      await createCall(post({ sdp: SDP_OFFER })),
      await createCall(new Request("http://localhost/v1/live", { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: "{}" })),
      await createCall(new Request("http://localhost/v1/live", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
    ];
    const { id } = await responses[0].clone().json();
    responses.push(await deleteCall(del(id), paramsOf(id)), await deleteCall(del("rtc_missing"), paramsOf("rtc_missing")));
    for (const response of responses) {
      for (const name of response.headers.keys()) expect(name.startsWith("access-control-")).toBe(false);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("never logs or returns tokens, SDP, instructions or upstream bodies", async () => {
    const logs = [];
    const spies = ["log", "info", "warn", "error", "debug"].map((method) =>
      vi.spyOn(console, method).mockImplementation((...args) => logs.push(args.map(String).join(" "))));
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("tok-1 upstream-secret", { status: 500 }));
    const failed = await createCall(post({ sdp: SDP_OFFER, instructions: "keep-private-instructions" }));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toMatch(/tok-1|upstream-secret|keep-private/);
    const ok = await createCall(post({ sdp: SDP_OFFER, instructions: "keep-private-instructions" }));
    const text = await ok.text();
    expect(JSON.parse(text).sdp).toBe(SDP_ANSWER);
    expect(text).not.toContain("tok-1");
    expect(text).not.toContain("ref-1");
    const everything = logs.join("\n");
    for (const secret of ["tok-1", "ref-1", SDP_OFFER, "keep-private-instructions", "upstream-secret"]) {
      expect(everything).not.toContain(secret);
    }
    for (const spy of spies) spy.mockRestore();
  });
});

describe("input validation", () => {
  const context = (count, text = "x") => Array.from({ length: count }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text }));
  it.each([
    ["missing sdp", { voice: "cove" }],
    ["sdp not starting with v=0", { sdp: "o=- 1 1\r\n" }],
    ["unknown field", { sdp: SDP_OFFER, foo: 1 }],
    ["unknown model", { sdp: SDP_OFFER, model: "openai/voice" }],
    ["voice with uppercase", { sdp: SDP_OFFER, voice: "Cove" }],
    ["voice too short", { sdp: SDP_OFFER, voice: "a" }],
    ["instructions over 16000", { sdp: SDP_OFFER, instructions: "i".repeat(16001) }],
    ["more than 50 context items", { sdp: SDP_OFFER, context: context(51) }],
    ["context role system", { sdp: SDP_OFFER, context: [{ role: "system", text: "x" }] }],
    ["context item extra key", { sdp: SDP_OFFER, context: [{ role: "user", text: "x", extra: 1 }] }],
    ["context over 16000 chars", { sdp: SDP_OFFER, context: [{ role: "user", text: "c".repeat(16001) }] }],
    ["array body", [{ sdp: SDP_OFFER }]],
    ["__proto__ field", "{\"sdp\":\"v=0\",\"__proto__\":{}}"],
  ])("rejects %s with 400 and no upstream call", async (_label, body) => {
    const response = await createCall(post(body));
    expect(response.status).toBe(400);
    expect(deps.getProviderCredentials).not.toHaveBeenCalled();
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content type and malformed JSON", async () => {
    expect((await createCall(post({ sdp: SDP_OFFER }, { "content-type": "text/plain" }))).status).toBe(400);
    expect((await createCall(post("{not json"))).status).toBe(400);
    expect(deps.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("rejects a declared body over 256 KB with 413", async () => {
    const response = await createCall(post({ sdp: SDP_OFFER }, { "content-length": String(256 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(deps.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("bounds a chunked body without Content-Length", async () => {
    const big = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(300 * 1024)); controller.close(); } });
    const request = new Request("http://localhost/v1/live", { method: "POST", body: big, duplex: "half", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" } });
    expect((await createCall(request)).status).toBe(413);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });
});

describe("upstream request shape", () => {
  it("sends the create call with the protocol headers and session ids", async () => {
    const response = await createCall(post({ sdp: SDP_OFFER }));
    expect(response.status).toBe(201);
    const [url, init, proxyOptions] = deps.proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CREATE_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      authorization: "Bearer tok-1", "chatgpt-account-id": "ws-1", "openai-alpha": "quicksilver=v2",
      originator: "9router", "content-type": "application/json",
    });
    expect(init.headers["user-agent"]).toMatch(/^9router\//);
    expect(init.headers["x-session-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.headers["voice-session-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(proxyOptions).toMatchObject({ strictProxy: true });
  });

  it("maps instructions and context into initial_items and uses the default session instructions", async () => {
    await openOne({
      sdp: SDP_OFFER, model: "cx/voice", voice: "marin", instructions: "Be brief.",
      context: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }],
    });
    const body = sentPayload();
    expect(body.sdp).toBe(SDP_OFFER);
    expect(body.session).toEqual({
      model: "gpt-live-1.1-codex",
      instructions: "Be brief.",
      audio: { output: { voice: "marin" } },
      delegation: { type: "client" },
      initial_items: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "Be brief." }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
      ],
    });
  });

  it("omits initial_items when there is nothing to send and defaults the voice", async () => {
    await openOne({ sdp: SDP_OFFER });
    const { session } = sentPayload();
    expect(session.audio.output.voice).toBe("cove");
    expect(typeof session.instructions).toBe("string");
    expect(session.instructions.length).toBeGreaterThan(0);
    expect(session).not.toHaveProperty("initial_items");
  });

  it("returns id, SDP answer, unix expires_at and Location", async () => {
    const response = await createCall(post({ sdp: SDP_OFFER }));
    const json = await response.json();
    expect(json.id).toBe(CALL_ID);
    expect(json.sdp).toBe(SDP_ANSWER);
    expect(Math.abs(json.expires_at - (Date.now() / 1000 + CALL_LIMIT_MS / 1000))).toBeLessThan(5);
    expect(response.headers.get("location")).toBe(`/v1/live/${CALL_ID}`);
  });

  it.each([
    ["missing Location", new Response(SDP_ANSWER, { status: 201 })],
    ["invalid Location id", new Response(SDP_ANSWER, { status: 201, headers: { location: "/v1/live/bad!id" } })],
    ["unexpected 200", new Response(SDP_ANSWER, { status: 200, headers: { location: `/v1/live/${CALL_ID}` } })],
  ])("returns 502 for an invalid upstream answer: %s", async (_label, upstream) => {
    deps.proxyAwareFetch.mockResolvedValueOnce(upstream);
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(502);
    expect(socketKit.state.sockets).toHaveLength(0);
    expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  });
});

describe("unusable 201 answers are hung up", () => {
  it("hangs up a 201 with a valid call id but a non-SDP body, and keeps no registry entry", async () => {
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("hello", { status: 201, headers: { location: `/v1/live/${CALL_ID}` } }));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(502);
    const socket = socketKit.state.sockets[0];
    expect(socket.url).toBe(`wss://api.openai.com/v1/live/${CALL_ID}`);
    expect(socket.sent.map((m) => JSON.parse(m))).toEqual([{ type: "session.close" }]);
    expect(socket.init.headers["x-session-id"]).toBe(deps.proxyAwareFetch.mock.calls[0][1].headers["x-session-id"]);
    expect(getCall(CALL_ID)).toBeNull();
  });

  it("hangs up a 201 whose SDP body is over the size limit", async () => {
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("v=0" + "a".repeat(300 * 1024), { status: 201, headers: { location: `/v1/live/${CALL_ID}` } }));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(502);
    expect(socketKit.state.sockets).toHaveLength(1);
    expect(getCall(CALL_ID)).toBeNull();
  });

  it("does not hang up when the 201 carries no valid call id, since there is nothing to close", async () => {
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response(SDP_ANSWER, { status: 201, headers: { location: "/v1/live/bad!id" } }));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(502);
    expect(socketKit.state.sockets).toHaveLength(0);
  });

  it("a duplicate registered id answers 502 and never hangs up the registered call", async () => {
    const { id } = await openOne();
    deps.proxyAwareFetch.mockImplementationOnce(async () => created(id));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(502);
    expect(socketKit.state.sockets).toHaveLength(0);
    expect(getCall(id)).not.toBeNull();
  });
});

describe("registry integrity", () => {
  it("refuses a second call that reuses a registered upstream id and keeps the first call", async () => {
    const { id } = await openOne();
    deps.proxyAwareFetch.mockImplementationOnce(async () => created(id));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(502);
    expect(getCall(id)).not.toBeNull();
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(200);
  });
});

describe("account selection and failover", () => {
  it("forces one refresh after 401 and retries with the new token", async () => {
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("denied", { status: 401 })).mockResolvedValueOnce(created());
    deps.checkAndRefreshToken.mockImplementation(async (_p, creds, options) => (options?.force ? { ...creds, accessToken: "tok-2" } : creds));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
    expect(deps.checkAndRefreshToken).toHaveBeenLastCalledWith("codex", expect.any(Object), { force: true });
    expect(deps.proxyAwareFetch.mock.calls[1][1].headers.authorization).toBe("Bearer tok-2");
  });

  it("marks the account for voice only on 401 with unchanged token and tries the next account", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(account()).mockResolvedValueOnce(account({ connectionId: "acct-2", workspace: "ws-2", accessToken: "tok-b" }));
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("denied", { status: 401 })).mockResolvedValueOnce(created());
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
    expect(deps.markAccountUnavailable).toHaveBeenCalledWith("acct-1", 401, expect.any(String), "codex", "voice");
    expect(deps.getProviderCredentials.mock.calls[1][1].has("acct-1")).toBe(true);
    expect(deps.getProviderCredentials.mock.calls[1][2]).toBe("voice");
    expect(deps.proxyAwareFetch.mock.calls[1][1].headers["chatgpt-account-id"]).toBe("ws-2");
  });

  it("on 403 marks only the voice scope and fails over", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(account()).mockResolvedValueOnce(account({ connectionId: "acct-2", workspace: "ws-2" }));
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("no", { status: 403 })).mockResolvedValueOnce(created());
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
    expect(deps.markAccountUnavailable).toHaveBeenCalledWith("acct-1", 403, expect.any(String), "codex", "voice");
  });

  it("returns 429 when every account is rate limited", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(account()).mockResolvedValueOnce({ allRateLimited: true, retryAfter: Date.now() + 60000 });
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(429);
    expect(deps.markAccountUnavailable).toHaveBeenCalledWith("acct-1", 429, expect.any(String), "codex", "voice");
    expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("returns 429 without any upstream call when all accounts are already rate limited", async () => {
    deps.getProviderCredentials.mockResolvedValue({ allRateLimited: true, retryAfter: Date.now() + 60000 });
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(429);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("returns 503 when no account is eligible", async () => {
    deps.getProviderCredentials.mockResolvedValue(null);
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(503);
  });

  const planToken = (plan) => `h.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_plan_type: plan } })).toString("base64url")}.s`;
  const withPlan = (account, plan) => ({ ...account, providerSpecificData: { ...account.providerSpecificData, chatgptPlanType: plan } });

  it.each([
    ["token claim", account({ accessToken: planToken("free") })],
    ["stored plan", withPlan(account(), "Free")],
  ])("skips a free plan account (%s) without calling upstream or marking it", async (_label, free) => {
    deps.getProviderCredentials.mockResolvedValueOnce(free).mockResolvedValueOnce(account({ connectionId: "acct-2", workspace: "ws-2" }));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
    expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(deps.proxyAwareFetch.mock.calls[0][1].headers["chatgpt-account-id"]).toBe("ws-2");
    expect(deps.getProviderCredentials.mock.calls[1][1].has("acct-1")).toBe(true);
    expect(deps.checkAndRefreshToken).toHaveBeenCalledTimes(1);
    expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("trusts the token claim over a stale stored free plan", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(withPlan(account({ accessToken: planToken("plus") }), "free"));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
  });

  it("says why when only free plan accounts exist", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(withPlan(account(), "free")).mockResolvedValueOnce(null);
    const response = await createCall(post({ sdp: SDP_OFFER }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toBe("No eligible Codex OAuth account for voice (free plan accounts are skipped)");
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("does not retry or cool down the account on upstream 503", async () => {
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(502);
    expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
    expect(deps.getProviderCredentials).toHaveBeenCalledTimes(1);
  });

  it.each([400, 404, 500])("on upstream %s returns 502, tries no other account and marks nothing", async (status) => {
    deps.proxyAwareFetch.mockResolvedValueOnce(new Response("oops", { status }));
    const response = await createCall(post({ sdp: SDP_OFFER }));
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toBe(`Codex voice call failed (upstream HTTP ${status})`);
    expect(deps.getProviderCredentials).toHaveBeenCalledTimes(1);
    expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it.each([
    ["error.code", { error: { code: "model_not_supported", message: "upstream-secret" } }, " model_not_supported"],
    ["detail.code", { detail: { code: "not_entitled", message: "upstream-secret" } }, " not_entitled"],
    ["a code that is free text", { error: { code: "upstream-secret tok-1", message: "x" } }, ""],
    ["an oversized body", { error: { code: "too_big", message: "x".repeat(20_000) } }, ""],
  ])("reports status and only a short machine code for %s", async (_label, body, suffix) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.proxyAwareFetch.mockResolvedValueOnce(Response.json(body, { status: 400 }));
    const response = await createCall(post({ sdp: SDP_OFFER }));
    const message = `Codex voice call failed (upstream HTTP 400${suffix})`;
    expect((await response.json()).error.message).toBe(message);
    const logged = warn.mock.calls.flat().join("\n");
    expect(logged).toContain(`upstream HTTP 400${suffix}`);
    expect(logged).not.toMatch(/upstream-secret|tok-1/);
    warn.mockRestore();
  });

  it("logs the error name and code when the upstream gives no response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.proxyAwareFetch.mockRejectedValueOnce(Object.assign(new TypeError("upstream-secret tok-1"), { cause: { code: "ECONNRESET" } }));
    const response = await createCall(post({ sdp: SDP_OFFER }));
    expect((await response.json()).error.message).toBe("Codex voice call failed");
    const logged = warn.mock.calls.flat().join("\n");
    expect(logged).toContain("TypeError ECONNRESET");
    expect(logged).not.toMatch(/upstream-secret|tok-1/);
    warn.mockRestore();
  });

  it("a client's bad SDP never reaches the upstream, so it cannot cool down an account", async () => {
    expect((await createCall(post({ sdp: "not sdp" }))).status).toBe(400);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("clears the voice error state on success", async () => {
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
    expect(deps.clearAccountError).toHaveBeenCalledWith("acct-1", expect.any(Object), "voice");
  });

  it("uses the voice model scope so a lock cannot reach chat or transcription", async () => {
    const { buildModelLockUpdate, isModelLockActive } = await import("open-sse/services/accountFallback.js");
    expect(Object.keys(buildModelLockUpdate("voice", 60000))).toEqual(["modelLock_voice"]);
    const future = new Date(Date.now() + 60000).toISOString();
    expect(isModelLockActive({ modelLock_voice: future }, "gpt-5.3-codex")).toBe(false);
    expect(isModelLockActive({ modelLock_voice: future }, "transcribe")).toBe(false);
    await createCall(post({ sdp: SDP_OFFER }));
    expect(deps.getProviderCredentials.mock.calls[0][2]).toBe("voice");
  });
});

describe("sticky hangup and DELETE", () => {
  it("hangs up on the creating account with the same session ids and frees the slot", async () => {
    const { id } = await openOne();
    const createHeaders = deps.proxyAwareFetch.mock.calls[0][1].headers;
    const response = deleteCall(del(id), paramsOf(id));
    expect((await response).status).toBe(200);
    expect(await (await deleteCall(del(id), paramsOf(id))).status).toBe(404);
    expect(deps.getProviderCredentials).toHaveBeenCalledTimes(1);
    expect(deps.getProviderConnections).toHaveBeenCalledWith({ provider: "codex" });
    const socket = socketKit.state.sockets[0];
    expect(socket.url).toBe(`wss://api.openai.com/v1/live/${CALL_ID}`);
    expect(socket.init.headers).toMatchObject({
      authorization: "Bearer tok-1", "chatgpt-account-id": "ws-1", "openai-alpha": "quicksilver=v2",
      "x-session-id": createHeaders["x-session-id"], "voice-session-id": createHeaders["voice-session-id"],
      originator: "9router", "user-agent": createHeaders["user-agent"],
    });
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([{ type: "session.close" }]);
    expect(socket.closed).toBe(true);
    expect(getCall(id)).toBeNull();
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
  });

  it("returns 404 for another key and keeps the call", async () => {
    const { id } = await openOne();
    expect((await deleteCall(del(id, OTHER_KEY), paramsOf(id))).status).toBe(404);
    expect(getCall(id)).not.toBeNull();
    expect(socketKit.state.sockets).toHaveLength(0);
  });

  it("returns 404 for unknown and malformed ids", async () => {
    expect((await deleteCall(del("rtc_missing"), paramsOf("rtc_missing"))).status).toBe(404);
    expect((await deleteCall(del("..%2Fx"), paramsOf("../x"))).status).toBe(404);
  });

  it("keeps the entry on hangup failure and succeeds on retry", async () => {
    const { id } = await openOne();
    socketKit.state.replies.push("error", "closed");
    const failed = await deleteCall(del(id), paramsOf(id));
    expect(failed.status).toBe(502);
    expect(getCall(id)).not.toBeNull();
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(200);
    expect(getCall(id)).toBeNull();
  });

  it("returns 502 and does not reselect when the creating account is gone", async () => {
    const { id } = await openOne();
    deps.getProviderConnections.mockResolvedValue([]);
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(502);
    expect(deps.getProviderCredentials).toHaveBeenCalledTimes(1);
    expect(getCall(id)).not.toBeNull();
    expect(socketKit.state.sockets).toHaveLength(0);
  });

  it("shares one hangup between two simultaneous DELETEs", async () => {
    const { id } = await openOne();
    const [a, b] = await Promise.all([deleteCall(del(id), paramsOf(id)), deleteCall(del(id), paramsOf(id))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(socketKit.state.sockets).toHaveLength(1);
  });

  it("returns 502 when the hangup receives no session.closed within 8 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id } = await openOne();
    socketKit.state.replies.push("silent");
    const pending = deleteCall(del(id), paramsOf(id));
    await flush();
    await vi.advanceTimersByTimeAsync(8000);
    expect((await pending).status).toBe(502);
    expect(getCall(id)).not.toBeNull();
  });
});

describe("time limit", () => {
  it("hangs the call up at 300 seconds and frees the slot", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id } = await openOne();
    await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS - 1);
    expect(getCall(id)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(getCall(id)).toBeNull();
    expect(socketKit.state.sockets[0].sent).toHaveLength(1);
  });

  it("retries the hangup a few times, then drops the entry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id } = await openOne();
    socketKit.state.defaultReply = "error";
    await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
    await flush();
    expect(getCall(id)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(HANGUP_RETRY_MS);
    await flush();
    expect(getCall(id)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(HANGUP_RETRY_MS);
    await flush();
    expect(getCall(id)).toBeNull();
    expect(socketKit.state.sockets).toHaveLength(3);
  });

  it("succeeds on a later retry before dropping", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id } = await openOne();
    socketKit.state.replies.push("error", "closed");
    await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
    await flush();
    await vi.advanceTimersByTimeAsync(HANGUP_RETRY_MS);
    await flush();
    expect(getCall(id)).toBeNull();
    expect(socketKit.state.sockets).toHaveLength(2);
  });

  it("a stale timer from a deleted call does not free a newer call", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = await openOne();
    expect((await deleteCall(del(first.id), paramsOf(first.id))).status).toBe(200);
    await vi.advanceTimersByTimeAsync(2000);
    const second = await openOne();
    await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS - 2000);
    await flush();
    expect(getCall(second.id)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(getCall(second.id)).toBeNull();
  });

  it("a DELETE racing the expiry timer shares one hangup and leaves the registry clean", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id } = await openOne();
    // Start the DELETE, then let the expiry timer fire while its hangup is in flight.
    const pending = deleteCall(del(id), paramsOf(id));
    await vi.advanceTimersByTimeAsync(CALL_LIMIT_MS);
    await flush();
    expect((await pending).status).toBe(200);
    expect(socketKit.state.sockets).toHaveLength(1);
    expect(getCall(id)).toBeNull();
    await vi.advanceTimersByTimeAsync(HANGUP_RETRY_MS * HANGUP_ATTEMPTS);
    expect(socketKit.state.sockets).toHaveLength(1);
  });
});

describe("concurrency limit", () => {
  it("allows at most two in-flight or committed calls", async () => {
    const gates = [];
    deps.getProviderCredentials.mockImplementation(() => new Promise((resolve) => gates.push(resolve)));
    const first = createCall(post({ sdp: SDP_OFFER }));
    const second = createCall(post({ sdp: SDP_OFFER }));
    for (let i = 0; i < 50 && gates.length < 2; i++) await flush();
    expect(gates).toHaveLength(2);
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(429);
    expect(deps.getProviderCredentials).toHaveBeenCalledTimes(2);
    gates[0](null);
    gates[1](null);
    expect((await first).status).toBe(503);
    expect((await second).status).toBe(503);
    deps.getProviderCredentials.mockResolvedValue(account());
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
  });

  it("counts committed calls against the limit and frees the slot on DELETE", async () => {
    const a = await openOne();
    await openOne();
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(429);
    expect((await deleteCall(del(a.id), paramsOf(a.id))).status).toBe(200);
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(201);
  });

  it("frees the slot when a call fails after reservation", async () => {
    deps.proxyAwareFetch.mockImplementation(async () => new Response("x", { status: 500 }));
    await createCall(post({ sdp: SDP_OFFER }));
    await createCall(post({ sdp: SDP_OFFER }));
    await createCall(post({ sdp: SDP_OFFER }));
    let n = 0;
    deps.proxyAwareFetch.mockImplementation(async () => created(`${CALL_ID}_ok${n++}`));
    await openOne();
    await openOne();
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(429);
  });
});

describe("proxy handling", () => {
  it("creates and hangs up through the account's connection proxy", async () => {
    const proxy = { source: "legacy", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080", connectionNoProxy: "", strictProxy: true };
    deps.resolveConnectionProxyConfig.mockResolvedValue(proxy);
    const { id } = await openOne();
    expect(deps.proxyAwareFetch.mock.calls[0][2]).toMatchObject({ connectionProxyUrl: "http://proxy.invalid:8080", strictProxy: true });
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(200);
    const socket = socketKit.state.sockets[0];
    expect(socket.init.dispatcher).toBeInstanceOf(socketKit.FakeProxyAgent);
    expect(socket.init.dispatcher.options).toEqual({ uri: "http://proxy.invalid:8080" });
    expect(socket.init.dispatcher.closed).toBe(true);
  });

  it("uses the environment proxy for the hangup WebSocket", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://env-proxy.invalid:3128");
    const { id } = await openOne();
    expect(deps.proxyAwareFetch.mock.calls[0][2]).toMatchObject({ strictProxy: true });
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(200);
    expect(socketKit.state.sockets[0].init.dispatcher.options).toEqual({ uri: "http://env-proxy.invalid:3128" });
  });

  it("refuses an account behind a relay: no create call, no unhealthy mark", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(account()).mockResolvedValueOnce(null);
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "vercel", vercelRelayUrl: "https://relay.invalid/relay", connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", strictProxy: true });
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(503);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("refuses an unresolved configured proxy instead of going direct", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(account()).mockResolvedValueOnce(null);
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "none", proxyPoolId: "pool-1", connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", strictProxy: false });
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(503);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("refuses the hangup on a relay account without opening a WebSocket", async () => {
    const { id } = await openOne();
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "vercel", vercelRelayUrl: "https://relay.invalid/relay", connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", strictProxy: true });
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(502);
    expect(socketKit.state.sockets).toHaveLength(0);
    expect(getCall(id)).not.toBeNull();
  });

  it("honours a NO_PROXY rule for the account proxy without opening a proxy agent", async () => {
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "legacy", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080", connectionNoProxy: "api.openai.com", strictProxy: false });
    const { id } = await openOne();
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(200);
    expect(socketKit.state.sockets[0].init).not.toHaveProperty("dispatcher");
    expect(socketKit.state.agents).toHaveLength(0);
  });

  it("a disabled legacy proxy with a saved URL is not configured: create and hangup go direct", async () => {
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "legacy", connectionProxyEnabled: false, connectionProxyUrl: "http://proxy.invalid:8080", connectionNoProxy: "", strictProxy: true });
    const { id } = await openOne();
    expect(deps.proxyAwareFetch.mock.calls[0][2]).toMatchObject({ connectionProxyEnabled: false, connectionProxyUrl: "", strictProxy: true });
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(200);
    expect(socketKit.state.sockets[0].init).not.toHaveProperty("dispatcher");
    expect(socketKit.state.agents).toHaveLength(0);
  });

  it("refuses an enabled proxy whose scheme undici cannot use, without marking the account", async () => {
    deps.getProviderCredentials.mockResolvedValueOnce(account()).mockResolvedValueOnce(null);
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "legacy", connectionProxyEnabled: true, connectionProxyUrl: "ftp://proxy.invalid:21", connectionNoProxy: "", strictProxy: false });
    expect((await createCall(post({ sdp: SDP_OFFER }))).status).toBe(503);
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
    expect(deps.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("uses a socks5 proxy for the hangup when undici can dispatch it", async () => {
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "legacy", connectionProxyEnabled: true, connectionProxyUrl: "socks5://proxy.invalid:1080", connectionNoProxy: "", strictProxy: true });
    const { id } = await openOne();
    expect((await deleteCall(del(id), paramsOf(id))).status).toBe(200);
    expect(socketKit.state.sockets[0].init.dispatcher.options).toEqual({ uri: "socks5://proxy.invalid:1080" });
  });
});

describe("proxy route rules", () => {
  const base = { connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", vercelRelayUrl: "" };
  const target = "wss://api.openai.com/v1/live/rtc_x";

  it("accepts http, https and socks5 proxies and refuses other schemes", async () => {
    const { resolveWebSocketRoute } = await import("../../src/mine/voice/proxy.js");
    for (const url of ["http://p.invalid:8080", "https://p.invalid:8443", "socks5://p.invalid:1080", "socks://p.invalid:1080", "127.0.0.1:7890"]) {
      expect(resolveWebSocketRoute({ ...base, connectionProxyEnabled: true, connectionProxyUrl: url }, target)).not.toBeNull();
    }
    for (const url of ["ftp://p.invalid:21", "vercel://p.invalid"]) {
      expect(resolveWebSocketRoute({ ...base, connectionProxyEnabled: true, connectionProxyUrl: url }, target)).toBeNull();
    }
  });

  it("refuses a configured but unresolved proxy pool and a relay, and allows no proxy at all", async () => {
    const { resolveWebSocketRoute } = await import("../../src/mine/voice/proxy.js");
    expect(resolveWebSocketRoute({ ...base, proxyPoolId: "pool-1" }, target)).toBeNull();
    expect(resolveWebSocketRoute({ ...base, vercelRelayUrl: "https://relay.invalid/r" }, target)).toBeNull();
    expect(resolveWebSocketRoute(base, target)).toEqual({ proxyUrl: null });
  });

  it("treats a disabled legacy URL as no proxy once resolved", async () => {
    const { resolveAccountProxy, resolveWebSocketRoute } = await import("../../src/mine/voice/proxy.js");
    deps.resolveConnectionProxyConfig.mockResolvedValue({ source: "legacy", connectionProxyEnabled: false, connectionProxyUrl: "http://p.invalid:8080", connectionNoProxy: "x", strictProxy: false });
    const proxy = await resolveAccountProxy({});
    expect(proxy.connectionProxyUrl).toBe("");
    expect(resolveWebSocketRoute(proxy, target)).toEqual({ proxyUrl: null });
  });
});

describe("client disconnect and slot reservation", () => {
  it("a client disconnect during the upstream create does not lose the call", async () => {
    const controller = new AbortController();
    let release;
    let createSignal;
    deps.proxyAwareFetch.mockImplementationOnce(async (_url, init) => {
      createSignal = init.signal;
      await new Promise((resolve) => { release = resolve; });
      return created();
    });
    const request = new Request("http://localhost/v1/live", {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ sdp: SDP_OFFER }),
    });
    const pending = createCall(request);
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.abort();
    release();
    const response = await pending;
    expect(response.status).toBe(201);
    expect(createSignal.aborted).toBe(false);
    expect(getCall(CALL_ID)).not.toBeNull();
  });

  it("a slow request body does not occupy a call slot", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const slowBody = new ReadableStream({ start(c) { c.enqueue(encoder.encode("{\"sdp\":\"v=0\"")); } });
    const slow = createCall(new Request("http://localhost/v1/live", {
      method: "POST", signal: controller.signal, body: slowBody, duplex: "half",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    }));
    await flush();
    expect(deps.getProviderCredentials).not.toHaveBeenCalled();
    await openOne();
    await openOne();
    expect(getCall(CALL_ID)).not.toBeNull();
    controller.abort();
    expect((await slow).status).not.toBe(201);
  });
});
