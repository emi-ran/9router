import { expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS } from "../../src/shared/constants/providers.js";
import * as example from "../../src/mine/stt/example.js";
const require = createRequire(import.meta.url);
const babel = require("next/dist/compiled/babel/core");
const root = new URL("../../src/", import.meta.url);
const detail = "app/(dashboard)/dashboard/media-providers/[kind]/[id]/";
const Box = ({ children }) => React.createElement("div", null, children);
const Link = ({ children, href }) => React.createElement("a", { href }, children);
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
    useRef: value => ({ current: value }), PropTypes: require("prop-types"),
    AI_PROVIDERS, MEDIA_PROVIDER_KINDS, ...example, ...extra,
  });
  return { tree(props) { index = 0; return Component(props); }, effects };
}
function find(node, type) {
  if (!node) return;
  if (node.type === type) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const match = find(child, type); if (match) return match; }
}

it("renders Codex STT detail with OAuth accounts, example and chat navigation", () => {
  const Connections = () => null;
  const Example = () => null;
  const page = fixture(`${detail}page.js`, "MediaProviderDetailPage", {
    useParams: () => ({ kind: "stt", id: "codex" }), notFound: () => { throw Error("404"); },
    ProviderIcon: Box, ConnectionsCard: Connections, ModelsCard: Box,
    CodexTranscriptionNotice: Box, SttExampleCard: Example, KIND_EXAMPLE_CONFIG: {},
  });
  const tree = page.tree();
  expect(find(tree, Connections).props).toMatchObject({ providerId: "codex", isOAuth: true });
  expect(find(tree, Example)).toBeTruthy();
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('href="/dashboard/providers/codex"');
  expect(html).toContain('href="/dashboard/media-providers/stt"');
});

it("rejects non-Codex STT details and excluded media kinds", () => {
  for (const params of [{ kind: "stt", id: "antigravity" }, { kind: "stt", id: "openai" }, { kind: "tts", id: "codex" }, { kind: "embedding", id: "codex" }, { kind: "video", id: "codex" }]) {
    const page = fixture(`${detail}page.js`, "MediaProviderDetailPage", {
      useParams: () => params, notFound: () => { throw Error("404"); },
    });
    expect(() => page.tree()).toThrow("404");
  }
});

it("keeps API-key connection creation unchanged for non-OAuth media", () => {
  const OAuth = () => null;
  const card = fixture("app/(dashboard)/dashboard/providers/components/ConnectionsCard.js", "ConnectionsCard", {
    OAuthModal: OAuth, Toggle: Box, ConfirmModal: Box, EditConnectionModal: Box, Select: Box,
  }, { 2: false });
  const tree = card.tree({ providerId: "tavily", isOAuth: false });
  expect(find(tree, OAuth)).toBeUndefined();
});

it("opens existing OAuthModal, then refreshes the shared Codex account pool", async () => {
  const OAuth = () => null;
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ connections: [], proxyPools: [] }) }));
  const card = fixture("app/(dashboard)/dashboard/providers/components/ConnectionsCard.js", "ConnectionsCard", {
    OAuthModal: OAuth, fetch, Toggle: Box, ConfirmModal: Box, EditConnectionModal: Box, Select: Box,
  }, { 2: false });
  const props = { providerId: "codex", isOAuth: true };
  const tree = card.tree(props);
  const button = find(tree, "button");
  button.props.onClick();
  const modal = find(card.tree(props), OAuth);
  expect(modal?.props).toMatchObject({ isOpen: true, provider: "codex", providerInfo: AI_PROVIDERS.codex });
  await modal.props.onSuccess();
  expect(fetch.mock.calls.map(([url]) => url)).toContain("/api/providers");
  expect(find(card.tree(props), OAuth).props.isOpen).toBe(false);
});

it("renders only json/text options and runs the supported transcription request", async () => {
  const fetch = vi.fn(async () => new Response('{"text":"hello"}', { headers: { "content-type": "application/json" } }));
  const card = fixture(`${detail}components/SttExampleCard.js`, "SttExampleCard", {
    Row: ({ label, children }) => React.createElement("label", null, label, children), fetch,
    useCopyToClipboard: () => ({ copy: vi.fn(), copied: false }),
  });
  let tree = card.tree({ providerId: "codex" });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("cx/transcribe");
  expect(html).toContain("/v1/audio/transcriptions");
  expect(html.match(/<option /g)).toHaveLength(2);
  expect(html).not.toMatch(/Language|Temperature|Speaker|verbose_json|srt|vtt/);
  find(tree, "input").props.onChange({ target: { files: [new File(["audio"], "sample.wav")] } });
  tree = card.tree({ providerId: "codex" });
  // The Run button is the only button not used for copying.
  const buttons = [];
  const walk = node => { if (!node) return; if (node.type === "button") buttons.push(node); React.Children.forEach(node.props?.children, walk); };
  walk(tree);
  await buttons.find(button => button.props.children === "Run").props.onClick();
  expect(fetch).toHaveBeenCalledWith("/api/v1/audio/transcriptions", expect.objectContaining({ method: "POST" }));
  expect(renderToStaticMarkup(card.tree({ providerId: "codex" }))).toContain("hello");
});
