import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import * as client from "../../src/mine/voice/client.js";
import * as example from "../../src/mine/voice/example.js";

const { createLiveCall, checkCallOptions, transcriptLine } = client;
const { buildServerExample, buildCurlExample, BROWSER_EXAMPLE } = example;
const require = createRequire(import.meta.url);
const babel = require("next/dist/compiled/babel/core");
const root = new URL("../../src/", import.meta.url);
const detail = "app/(dashboard)/dashboard/media-providers/[kind]/[id]/";
const KEY = "gw-test-key-1234";
const Box = ({ children }) => React.createElement("div", null, children);
const Link = ({ children, href }) => React.createElement("a", { href }, children);

// Same harness as codex-stt-media-ui.test.js: strip single-line imports, inject names.
function fixture(path, name, extra = {}, initial = {}) {
  let index = 0;
  const values = { ...initial };
  const effects = [];
  const source = fs.readFileSync(new URL(path, root), "utf8");
  const code = babel.transformSync(source.replace(/^import .*;\r?\n/gm, "").replace(/export (?:default )?function/g, "function"), {
    configFile: false, babelrc: false, presets: [require("next/dist/compiled/babel/preset-react")],
  }).code;
  const Component = vm.runInNewContext(`${code}\n${name}`, {
    React, Card: Box, Badge: Box, Button: "button", Link,
    useState: initialValue => { const slot = index++; return [Object.hasOwn(values, slot) ? values[slot] : initialValue, value => { values[slot] = value; }]; },
    useEffect: effect => effects.push(effect), useCallback: fn => fn,
    useSyncExternalStore: (subscribe, snapshot, serverSnapshot) => serverSnapshot(),
    useRef: value => ({ current: value }),
    AI_PROVIDERS, MEDIA_PROVIDER_KINDS, ...client, ...example, ...extra,
  });
  return { tree(props) { index = 0; return Component(props); }, effects };
}
function find(node, type) {
  if (!node) return;
  if (node.type === type) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const match = find(child, type); if (match) return match; }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 4; i++) await flush(); };
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const defaultFetch = (url, init) => (init.method === "DELETE"
  ? json(200, { id: "call_1", status: "closed" })
  : json(201, { id: "call_1", sdp: "v=0 answer", expires_at: 1300 }));

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { tracks, getTracks: () => tracks };
}

function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    list: () => [...pending.values()].map((t) => t.ms),
    fire: (ms) => { for (const [id, t] of [...pending]) if (t.ms === ms) { pending.delete(id); t.fn(); } },
  };
}

function harness({ iceDone = true, failAnswer = false, mic, noMic = false, fetch: fetchImpl = defaultFetch, now = 1_000_000 } = {}) {
  const log = [];
  const peers = [];
  const streams = [];
  const updates = [];
  const remote = [];
  const events = [];
  function FakePeer() {
    const peer = {
      connectionState: "new",
      iceGatheringState: "new",
      localDescription: null,
      addTrack: vi.fn(),
      createDataChannel: vi.fn((label) => { log.push("createDataChannel"); peer.channel = { label, onmessage: null }; return peer.channel; }),
      createOffer: vi.fn(async () => { log.push("createOffer"); return { type: "offer", sdp: "v=0 offer" }; }),
      setLocalDescription: vi.fn(async (desc) => {
        peer.localDescription = { type: desc.type, sdp: desc.sdp };
        peer.iceGatheringState = iceDone ? "complete" : "gathering";
      }),
      setRemoteDescription: vi.fn(async () => { if (failAnswer) throw new Error("Bad answer"); }),
      close: vi.fn(() => { peer.closed = true; }),
    };
    peers.push(peer);
    return peer;
  }
  const timers = fakeTimers();
  const getUserMedia = noMic ? undefined : vi.fn(mic || (async () => { const s = fakeStream(); streams.push(s); return s; }));
  const fetch = vi.fn(fetchImpl);
  const ctl = createLiveCall({
    fetch, RTCPeerConnection: FakePeer, getUserMedia,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, now: () => now,
    onUpdate: (s) => updates.push(s), onRemoteStream: (s) => remote.push(s), onEvent: (e) => events.push(e),
  });
  return { ctl, fetch, peers, streams, timers, updates, remote, events, log, getUserMedia, peer: () => peers[0] };
}

const deletes = (h) => h.fetch.mock.calls.filter(([, init]) => init.method === "DELETE");
const posts = (h) => h.fetch.mock.calls.filter(([, init]) => init.method === "POST");

async function connect(h) {
  await h.ctl.start({ apiKey: KEY, voice: "cove" });
  await settle();
  expect(h.ctl.snapshot().phase).toBe("connected");
}

describe("catalog and navigation", () => {
  it("adds Live after Speech to Text and exposes it for Codex only", () => {
    const ids = MEDIA_PROVIDER_KINDS.map((k) => k.id);
    expect(ids.indexOf("live")).toBe(ids.indexOf("stt") + 1);
    expect(MEDIA_PROVIDER_KINDS.find((k) => k.id === "live")).toEqual({
      id: "live", label: "Live", icon: "graphic_eq", endpoint: { method: "POST", path: "/v1/live" },
    });
    expect(getProvidersByKind("live").map((p) => p.id)).toEqual(["codex"]);
    expect(AI_PROVIDERS.codex.serviceKinds).toEqual(expect.arrayContaining(["llm", "stt", "live"]));
    const withLive = Object.values(AI_PROVIDERS).filter((p) => (p.serviceKinds ?? []).includes("live")).map((p) => p.id);
    expect(withLive).toEqual(["codex"]);
  });

  it("shows Live in the sidebar", () => {
    const sidebar = fs.readFileSync(new URL("../../src/shared/components/Sidebar.js", import.meta.url), "utf8");
    expect(sidebar.match(/^const VISIBLE_MEDIA_KINDS = \[([^\r\n]+)\];/m)[1]).toContain('"live"');
  });

  it("keeps /v1/models limited to llm, stt and tts kinds", () => {
    const models = fs.readFileSync(new URL("app/api/v1/models/route.js", root), "utf8");
    expect(models).toContain('const kinds = kind === "stt" || kind === "tts" ? [kind] : ["llm"];');
  });

  it("renders the Live detail page for Codex with toggle, OAuth connections, models and example", () => {
    const Connections = () => null;
    const Voice = () => null;
    const Example = () => null;
    const Models = () => null;
    const page = fixture(`${detail}page.js`, "MediaProviderDetailPage", {
      useParams: () => ({ kind: "live", id: "codex" }), notFound: () => { throw Error("404"); },
      ProviderIcon: Box, ConnectionsCard: Connections, ModelsCard: Models, CodexTranscriptionNotice: Box,
      SttExampleCard: Box, LiveExampleCard: Example, VoiceCallsCard: Voice, KIND_EXAMPLE_CONFIG: {},
    });
    const tree = page.tree();
    expect(find(tree, Connections).props).toMatchObject({ providerId: "codex", isOAuth: true });
    expect(find(tree, Voice)).toBeTruthy();
    expect(find(tree, Example)).toBeTruthy();
    expect(find(tree, Models)).toBeUndefined();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("cx/voice");
    expect(html).toContain("300 s max");
    expect(html).toContain('href="/dashboard/providers/codex"');
    expect(html).toContain('href="/dashboard/media-providers/live"');
  });

  it("rejects Live for other providers and for other kinds", () => {
    for (const params of [{ kind: "live", id: "openai" }, { kind: "live", id: "antigravity" }, { kind: "tts", id: "codex" }]) {
      const page = fixture(`${detail}page.js`, "MediaProviderDetailPage", {
        useParams: () => params, notFound: () => { throw Error("404"); }, KIND_EXAMPLE_CONFIG: {},
      });
      expect(() => page.tree()).toThrow("404");
    }
  });
});

describe("voice call lifecycle", () => {
  it("a: a denied microphone shows an error and sends no request", async () => {
    const h = harness({ mic: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } });
    await h.ctl.start({ apiKey: KEY });
    await settle();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.peers).toHaveLength(0);
    expect(h.ctl.snapshot()).toMatchObject({ phase: "ended", reason: "error", error: "Microphone access was denied." });
  });

  it("a: an unavailable microphone (insecure context) shows an error and sends no request", async () => {
    const h = harness({ noMic: true });
    await h.ctl.start({ apiKey: KEY });
    await settle();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.peers).toHaveLength(0);
    expect(h.ctl.snapshot().error).toContain("HTTPS");
  });

  it("b: the data channel exists before the offer, and the POST waits for ICE (max 3 s)", async () => {
    const h = harness({ iceDone: false });
    void h.ctl.start({ apiKey: KEY, voice: "cove" });
    await settle();
    expect(h.log.indexOf("createDataChannel")).toBeGreaterThanOrEqual(0);
    expect(h.log.indexOf("createDataChannel")).toBeLessThan(h.log.indexOf("createOffer"));
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.timers.list()).toContain(3000);
    h.timers.fire(3000);
    await settle();
    expect(posts(h)).toHaveLength(1);
    const [url, init] = posts(h)[0];
    expect(url).toBe("/api/v1/live");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toMatchObject({ sdp: "v=0 offer", voice: "cove", model: "cx/voice" });
    expect(h.ctl.snapshot().phase).toBe("connected");
  });

  it("b: a completed ICE gathering does not wait for the timer", async () => {
    const h = harness({ iceDone: true });
    await connect(h);
    expect(h.timers.list()).not.toContain(3000);
  });

  it("c: a second Start while the call is active or pending does nothing", async () => {
    const h = harness();
    await connect(h);
    await h.ctl.start({ apiKey: KEY });
    await settle();
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(posts(h)).toHaveLength(1);

    let resolvePost;
    const pending = new Promise((resolve) => { resolvePost = resolve; });
    const slow = harness({ fetch: (url, init) => (init.method === "POST" ? pending : defaultFetch(url, init)) });
    void slow.ctl.start({ apiKey: KEY });
    await settle();
    void slow.ctl.start({ apiKey: KEY });
    await settle();
    expect(slow.getUserMedia).toHaveBeenCalledTimes(1);
    expect(posts(slow)).toHaveLength(1);
    resolvePost(json(201, { id: "call_1", sdp: "v=0 answer", expires_at: 1300 }));
    await settle();
  });

  it("c: a second Start while the microphone prompt is open does nothing", async () => {
    let grant;
    const h = harness({ mic: () => new Promise((resolve) => { grant = resolve; }) });
    void h.ctl.start({ apiKey: KEY });
    await settle();
    void h.ctl.start({ apiKey: KEY });
    await settle();
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    grant(fakeStream());
    await settle();
  });

  it("d: End stops all tracks, closes the peer connection and sends exactly one DELETE", async () => {
    const h = harness();
    await connect(h);
    const [stream] = h.streams;
    h.ctl.end("ended by user");
    await settle();
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.peer().close).toHaveBeenCalledTimes(1);
    expect(deletes(h)).toHaveLength(1);
    const [url, init] = deletes(h)[0];
    expect(url).toBe("/api/v1/live/call_1");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.keepalive).toBe(false);
    h.ctl.end("again");
    await settle();
    expect(deletes(h)).toHaveLength(1);
    expect(h.ctl.snapshot()).toMatchObject({ phase: "ended", reason: "ended by user" });
  });

  it("d: session.closed ends the call with one DELETE", async () => {
    const h = harness();
    await connect(h);
    h.peer().channel.onmessage({ data: JSON.stringify({ type: "session.closed" }) });
    await settle();
    expect(deletes(h)).toHaveLength(1);
    expect(h.ctl.snapshot().reason).toBe("session closed");
    expect(h.peer().close).toHaveBeenCalledTimes(1);
  });

  it("d: connection failed or closed ends the call, while disconnected does not", async () => {
    const h = harness();
    await connect(h);
    h.peer().connectionState = "disconnected";
    h.peer().onconnectionstatechange();
    await settle();
    expect(deletes(h)).toHaveLength(0);
    expect(h.ctl.snapshot().phase).toBe("connected");

    h.peer().connectionState = "failed";
    h.peer().onconnectionstatechange();
    await settle();
    expect(deletes(h)).toHaveLength(1);
    expect(h.ctl.snapshot().reason).toBe("connection failed");

    const closed = harness();
    await connect(closed);
    closed.peer().connectionState = "closed";
    closed.peer().onconnectionstatechange();
    await settle();
    expect(deletes(closed)).toHaveLength(1);
  });

  it("d: the time limit ends the call with one DELETE", async () => {
    const h = harness();
    await connect(h);
    expect(h.timers.list()).toContain(300_000);
    h.timers.fire(300_000);
    await settle();
    expect(deletes(h)).toHaveLength(1);
    expect(h.ctl.snapshot().reason).toBe("time limit reached");
    expect(h.peer().close).toHaveBeenCalledTimes(1);
  });

  it("d: an error after the call was created sends one DELETE", async () => {
    const h = harness({ failAnswer: true });
    await h.ctl.start({ apiKey: KEY });
    await settle();
    expect(deletes(h)).toHaveLength(1);
    expect(h.ctl.snapshot()).toMatchObject({ phase: "ended", reason: "error", error: "Bad answer" });
  });

  it("d: a failed create (no id) sends no DELETE and shows the server message", async () => {
    const h = harness({ fetch: () => json(429, { error: { message: "Too many calls" } }) });
    await h.ctl.start({ apiKey: KEY });
    await settle();
    expect(deletes(h)).toHaveLength(0);
    expect(h.ctl.snapshot()).toMatchObject({ phase: "ended", error: "Too many calls" });
  });

  it("d: unmount or pagehide ends the call with a keepalive DELETE", async () => {
    const h = harness();
    await connect(h);
    h.ctl.end("left the page", { keepalive: true });
    await settle();
    expect(deletes(h)).toHaveLength(1);
    expect(deletes(h)[0][1].keepalive).toBe(true);
  });

  it("e: End during the POST does not abort it, does not apply the answer, and DELETEs on resolve", async () => {
    let resolvePost;
    const pending = new Promise((resolve) => { resolvePost = resolve; });
    const h = harness({ fetch: (url, init) => (init.method === "POST" ? pending : defaultFetch(url, init)) });
    void h.ctl.start({ apiKey: KEY });
    await settle();
    const [stream] = h.streams;
    h.ctl.end("ended by user");
    await settle();
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(deletes(h)).toHaveLength(0);
    expect(posts(h)[0][1].signal).toBeUndefined();

    resolvePost(json(201, { id: "call_late", sdp: "v=0 answer", expires_at: 1300 }));
    await settle();
    expect(h.peer().setRemoteDescription).not.toHaveBeenCalled();
    expect(deletes(h)).toHaveLength(1);
    expect(deletes(h)[0][0]).toBe("/api/v1/live/call_late");
    expect(deletes(h)[0][1].keepalive).toBe(true);
    expect(h.ctl.snapshot().phase).toBe("ended");
  });

  it("e: End while asking for the microphone releases the stream on arrival and sends no POST", async () => {
    let grant;
    const h = harness({ mic: () => new Promise((resolve) => { grant = resolve; }) });
    void h.ctl.start({ apiKey: KEY });
    await settle();
    h.ctl.end("ended by user");
    await settle();
    const stream = fakeStream();
    grant(stream);
    await settle();
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.peers).toHaveLength(0);
  });

  it("g: a failed DELETE is shown to the user and not swallowed", async () => {
    const h = harness({ fetch: (url, init) => (init.method === "DELETE"
      ? json(502, { error: { message: "upstream down" } })
      : defaultFetch(url, init)) });
    await connect(h);
    h.ctl.end("ended by user");
    await settle();
    expect(h.ctl.snapshot().error).toContain("Call may still be open on the server");
    expect(h.ctl.snapshot().error).toContain("upstream down");
  });

  it("g: a network failure on DELETE is shown to the user", async () => {
    const h = harness({ fetch: (url, init) => (init.method === "DELETE"
      ? Promise.reject(new TypeError("Failed to fetch"))
      : defaultFetch(url, init)) });
    await connect(h);
    await h.ctl.end("left the page", { keepalive: true });
    expect(h.ctl.snapshot().error).toContain("Call may still be open on the server");
  });

  it("h: the API key never appears in state snapshots, and nothing is logged", async () => {
    const spies = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
    try {
      const h = harness();
      await connect(h);
      h.ctl.end("ended by user");
      await settle();
      expect(JSON.stringify(h.updates)).not.toContain(KEY);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("rejects invalid voice or instructions before the microphone is requested", async () => {
    const h = harness();
    await h.ctl.start({ apiKey: KEY, voice: "Cove" });
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(h.ctl.snapshot().error).toContain("Voice");
    expect(checkCallOptions({ voice: "cove", instructions: "x".repeat(16_001) })).toContain("16000");
    expect(checkCallOptions({ voice: "cove", instructions: "Be brief." })).toBe("");
  });

  it("lists finished turns and skips partial transcript deltas", async () => {
    const h = harness();
    await connect(h);
    const emit = (event) => h.peer().channel.onmessage({ data: JSON.stringify(event) });
    emit({ type: "input_transcript.added", item: { text: "Hel" } });
    emit({ type: "output_transcript.added", item: { text: "Hi" } });
    emit({ type: "turn.done", turn: { role: "user", transcript: " Hello" } });
    emit({ type: "turn.done", turn: { role: "assistant", transcript: "Hi there" } });
    emit({ type: "turn.done", turn: { role: "other", transcript: "ignored" } });
    expect(h.events).toEqual([{ speaker: "You", text: "Hello" }, { speaker: "Assistant", text: "Hi there" }]);
    expect(transcriptLine({ type: "delegation.created", item: { content: [{ text: "a " }, { text: "b" }] } })).toEqual({ speaker: "Delegation", text: "a b" });
  });

  it("makes Start available again after End during the POST", async () => {
    let resolvePost;
    const pending = new Promise((resolve) => { resolvePost = resolve; });
    const h = harness({ fetch: (url, init) => (init.method === "POST" ? pending : defaultFetch(url, init)) });
    void h.ctl.start({ apiKey: KEY });
    await settle();
    h.ctl.end("ended by user");
    await settle();
    expect(h.updates.at(-1).canStart).toBe(false);
    resolvePost(json(201, { id: "call_late", sdp: "v=0 answer", expires_at: 1300 }));
    await settle();
    expect(h.updates.at(-1)).toMatchObject({ canStart: true, error: "" });
  });

  it("does not warn when the call is already over", async () => {
    const gone = (url, init) => (init.method === "DELETE"
      ? json(404, { error: { message: "Voice call not found" } })
      : defaultFetch(url, init));
    const closed = harness({ fetch: gone });
    await connect(closed);
    closed.peer().channel.onmessage({ data: JSON.stringify({ type: "session.closed" }) });
    await settle();
    expect(closed.ctl.snapshot().error).toBe("");

    const timed = harness({ fetch: gone });
    await connect(timed);
    timed.timers.fire(300_000);
    await settle();
    expect(timed.ctl.snapshot().error).toBe("");

    const manual = harness({ fetch: gone });
    await connect(manual);
    await manual.ctl.end("ended by user");
    expect(manual.ctl.snapshot().error).toContain("may still be open");
  });

  it("does not depend on the server clock for the time limit", async () => {
    const h = harness({ now: 9_000_000_000 });
    await connect(h);
    expect(h.timers.list()).toContain(300_000);
    expect(h.ctl.snapshot().expiresAt).toBe(9_000_300);
  });
});

describe("example builders", () => {
  const hostile = "it's \"quoted\" \\ </script> ${x}";

  it("never contain a typed key and escape user text", () => {
    const server = buildServerExample({ origin: "https://app.example", voice: "cove", instructions: hostile });
    const curl = buildCurlExample({ origin: "https://app.example", voice: "cove", instructions: hostile });
    const all = [BROWSER_EXAMPLE, server, curl].join("\n");
    expect(all).not.toContain("sk-typed");
    expect(all).not.toContain(KEY);
    expect(all).toContain("YOUR_KEY");
    expect(server).toContain("process.env.NINE_ROUTER_KEY");

    const literal = server.match(/^const INSTRUCTIONS = (.*);$/m)[1];
    expect(JSON.parse(literal)).toBe(hostile);

    const dLine = curl.split("\n").find((line) => line.includes("-d "));
    const shellArg = dLine.slice(dLine.indexOf("-d ") + 3);
    const unquoted = shellArg.slice(1, -1).replaceAll(`'"'"'`, "'");
    expect(JSON.parse(unquoted)).toMatchObject({ voice: "cove", instructions: hostile, model: "cx/voice" });
  });

  it("browser example talks only to the integrator backend", () => {
    expect(BROWSER_EXAMPLE).toContain('fetch("/voice"');
    expect(BROWSER_EXAMPLE).toContain('"oai-events"');
    expect(BROWSER_EXAMPLE).not.toContain("/v1/live");
  });
});

describe("Live example card and voice toggle", () => {
  it("renders the three request tabs, the status line and no typed key", () => {
    const card = fixture(`${detail}components/LiveExampleCard.js`, "LiveExampleCard", {
      Card: Box, Row: ({ label, children }) => React.createElement("label", null, label, children),
      useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
    });
    const html = renderToStaticMarkup(card.tree({}));
    expect(html).toContain("cx/voice");
    expect(html).toContain("/v1/live");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Server (Node)");
    expect(html).toContain('role="status"');
    expect(html).toContain("Response (example)");
  });

  it("voice toggle loads the saved value and keeps the real value when the save fails", async () => {
    const ToggleStub = () => null;
    const save = { result: null };
    const store = {
      getState: () => ({
        fetchSettings: async () => ({ voiceEnabled: false }),
        patchSettings: async () => save.result,
      }),
    };
    const card = fixture(`${detail}components/VoiceCallsCard.js`, "VoiceCallsCard", {
      Card: Box, Toggle: ToggleStub, useSettingsStore: store,
    });
    let tree = card.tree();
    const cleanup = card.effects[0]();
    await settle();
    tree = card.tree();
    expect(find(tree, ToggleStub).props.checked).toBe(false);
    expect(find(tree, ToggleStub).props.disabled).toBe(false);

    save.result = null;
    await find(tree, ToggleStub).props.onChange();
    await settle();
    tree = card.tree();
    expect(find(tree, ToggleStub).props.checked).toBe(false);
    expect(renderToStaticMarkup(tree)).toContain("Could not save");

    save.result = { voiceEnabled: true };
    await find(card.tree(), ToggleStub).props.onChange();
    await settle();
    expect(find(card.tree(), ToggleStub).props.checked).toBe(true);
    cleanup?.();
  });
});
