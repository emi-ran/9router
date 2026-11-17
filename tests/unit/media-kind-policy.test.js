import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import { isServiceKindAllowed } from "../../src/mine/providers/mediaKinds.js";

describe("fork media kind policy", () => {
  it("text-to-image lists only codex and antigravity", () => {
    const ids = getProvidersByKind("image").map((p) => p.id);
    expect(ids.sort()).toEqual(["antigravity", "codex"]);
  });
  it("web search and fetch keep exactly the four providers", () => {
    expect(getProvidersByKind("webSearch").map((p) => p.id).sort())
      .toEqual(["brave-search", "exa", "tavily", "tinyfish"]);
    expect(getProvidersByKind("webFetch").map((p) => p.id).sort())
      .toEqual(["tavily", "tinyfish"]);
  });
  it("image-to-text is gone from kinds, provider lists and dispatch", () => {
    expect(MEDIA_PROVIDER_KINDS.some((k) => k.id === "imageToText")).toBe(false);
    expect(getProvidersByKind("imageToText")).toEqual([]);
    expect(AI_PROVIDERS.anthropic.serviceKinds).not.toContain("imageToText");
    expect(isServiceKindAllowed("openai", "imageToText")).toBe(false);
  });
  it("other kinds of shared providers stay intact", () => {
    expect(AI_PROVIDERS.antigravity.serviceKinds.sort()).toEqual(["image", "llm"]);
    expect(AI_PROVIDERS.gemini.serviceKinds).toEqual([]);
    expect(AI_PROVIDERS.openai.serviceKinds).toEqual([]);
    const chat = getProvidersByKind("llm").map((p) => p.id);
    expect(chat).toEqual(expect.arrayContaining(["antigravity", "codex", "opencode"]));
  });
});
