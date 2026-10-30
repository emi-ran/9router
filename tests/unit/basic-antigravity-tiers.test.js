import { describe, it, expect } from "vitest";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../../open-sse/providers/shared.js";

describe("BASIC Antigravity tiers", () => {
  it.each(["low", "medium", "high"])("registers Argon %s", tier => {
    expect(antigravity.models.find(m => m.id === `gemini-4-argon-${tier}`)?.upstreamModelId).toBe(`gemini-4-argon-${tier}(${tier})`);
  });
  it("routes unadorned Flash by effort without changing other providers", () => {
    expect(getModelUpstreamId("ag", "gemini-3.8-flash", { reasoning_effort: "high" })).toBe("gemini-3.8-flash-high");
    expect(getModelUpstreamId("cx", "gpt-6-sol", { reasoning_effort: "high" })).toBe("gpt-6-sol");
  });
  it("uses the Hub fingerprint", () => expect(ANTIGRAVITY_IDE_USER_AGENT).toBe("antigravity/hub/2.24.0 darwin/arm64"));
});
