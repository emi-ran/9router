import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getProvidersByKind } from "../../src/shared/constants/providers.js";
import { getProviderIconSrc, markProviderIconMissing } from "../../src/shared/utils/providerIcon.js";

const require = createRequire(import.meta.url);
const babel = require("next/dist/compiled/babel/core");
const root = new URL("../../", import.meta.url);
const source = fs.readFileSync(new URL("src/app/(dashboard)/dashboard/providers/page.js", root), "utf8");
function compile(text, name, bindings) {
  const code = babel.transformSync(text.replace(/^import .*;\r?\n/gm, "").replace("export default function", "function"), {
    configFile: false, babelrc: false, presets: [require("next/dist/compiled/babel/preset-react")],
  }).code;
  return vm.runInNewContext(`${code}\n${name}`, { React, ...bindings });
}
const cn = (...values) => values.filter(Boolean).join(" ");
const Card = compile(fs.readFileSync(new URL("src/shared/components/Card.js", root), "utf8"), "Card", { cn });
const Badge = compile(fs.readFileSync(new URL("src/shared/components/Badge.js", root), "utf8"), "Badge", { cn });
const ProviderIcon = compile(fs.readFileSync(new URL("src/shared/components/ProviderIcon.js", root), "utf8"), "ProviderIcon", {
  useState: React.useState, PropTypes: require("prop-types"), getProviderIconSrc, markProviderIconMissing,
});
function fixture(fetch) {
  let values = [null, false], index = 0, effect;
  const Page = compile(source, "ProvidersPage", {
    useState: initial => { const slot = index++; return [values[slot] ?? initial, value => { values[slot] = value; }]; },
    useEffect: fn => { effect = fn; },
    Link: ({ children, ...props }) => React.createElement("a", props, children),
    Card, Badge, ProviderIcon, getProvidersByKind, fetch, AbortController, setTimeout, clearTimeout,
  });
  return {
    render() { index = 0; return renderToStaticMarkup(Page()); },
    load() { return effect(); },
  };
}
const response = connections => ({ ok: true, json: async () => ({ connections }) });
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("retained provider cards", () => {
  it("renders only retained providers, existing 40px logos and accessible compact links", () => {
    const page = fixture(vi.fn());
    const html = page.render();
    expect(getProvidersByKind("llm").map(p => p.id)).toEqual(["antigravity", "codex", "opencode"]);
    for (const provider of getProvidersByKind("llm")) {
      expect(fs.existsSync(new URL(`public${getProviderIconSrc(provider.id)}`, root))).toBe(true);
      expect(html).toContain(`href="/dashboard/providers/${provider.id}"`);
      expect(html).toContain(`src="${getProviderIconSrc(provider.id)}"`);
    }
    expect(html.match(/width="40" height="40"/g)).toHaveLength(3);
    expect(html.match(/alt=""/g)).toHaveLength(3);
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("focus-visible:outline");
    expect(html).toContain("Loading connections...");
    expect(html).toContain("Free");
    expect(html).toContain("Ready");
    expect(html).not.toContain("No connections");
  });
  it("counts enabled OAuth accounts, errors, unknown and cooldowns without legacy contamination", async () => {
    const fetch = vi.fn(async () => response([
      ...["active", "success", "unavailable"].map(testStatus => ({ provider: "antigravity", authType: "oauth", testStatus })),
      { provider: "antigravity", authType: "oauth", testStatus: "active", isActive: false },
      { provider: "antigravity", authType: "apikey", testStatus: "active" },
      { provider: "kiro", authType: "oauth", testStatus: "active" },
      { provider: "codex", authType: "oauth", testStatus: "unavailable", modelLock_x: "2999-01-01" },
      { provider: "codex", authType: "oauth", testStatus: "unknown" },
    ]));
    const page = fixture(fetch); page.render(); const cleanup = page.load(); await settle();
    const html = page.render();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("/api/providers");
    expect(html).toContain("3 Connected");
    expect(html).toContain("1 Error");
    expect(html).toContain("1 Unknown");
    expect(html).not.toContain("4 Connected"); cleanup();
  });
  it("distinguishes empty from disabled accounts", async () => {
    const page = fixture(async () => response([{ provider: "codex", authType: "oauth", isActive: false, testStatus: "success" }]));
    page.render(); const cleanup = page.load(); await settle();
    expect(page.render()).toContain("No connections");
    expect(page.render()).toContain("Disabled"); cleanup();
  });
  for (const [name, fetch] of [
    ["HTTP failure", async () => ({ ok: false })],
    ["network failure", async () => { throw new Error("offline"); }],
    ["malformed DTO", async () => response([null])],
    ["missing DTO", async () => ({ ok: true, json: async () => ({}) })],
  ]) it(`${name} shows error, never false zero; no-auth remains Ready`, async () => {
    const page = fixture(fetch); page.render(); const cleanup = page.load(); await settle();
    const html = page.render(); expect(html).toContain("Unable to load connections");
    expect(html).not.toContain("No connections"); expect(html).toContain("Ready"); cleanup();
  });
  it("shows timeout error instead of false zero", async () => {
    vi.useFakeTimers();
    try {
      const page = fixture((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
      page.render(); const cleanup = page.load();
      await vi.advanceTimersByTimeAsync(10000); await settle();
      expect(page.render()).toContain("Unable to load connections");
      expect(page.render()).not.toContain("No connections"); cleanup();
    } finally { vi.useRealTimers(); }
  });
  it("aborts after 10 seconds and ignores late unmounted responses", async () => {
    vi.useFakeTimers();
    try {
      let finish, signal;
      const page = fixture((url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
      page.render(); const cleanup = page.load();
      await vi.advanceTimersByTimeAsync(10000); expect(signal.aborted).toBe(true);
      cleanup(); finish(response([])); await settle();
      expect(page.render()).toContain("Loading connections...");
      expect(page.render()).not.toContain("No connections");
    } finally { vi.useRealTimers(); }
  });
});
