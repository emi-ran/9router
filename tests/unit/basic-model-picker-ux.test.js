import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { matchesSearch, parseSearchQuery, getDeactivatedProviderIds, filterEnabledModels } from "../../src/shared/utils/modelSearchFilter.js";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("basic model picker filtering regressions", () => {
  it("supports provider plus model terms and never bypasses provider exclusions", () => {
    const fields = ["Sonnet", "claude-sonnet", "ag/claude-sonnet", "Antigravity", "ag"];
    expect(matchesSearch(fields, "antigravity sonnet -haiku")).toBe(true);
    expect(matchesSearch(fields, "sonnet !antigravity")).toBe(false);
    expect(matchesSearch(fields, "/^(?!.*Antigravity).*$/i")).toBe(false);
  });

  it.each(["/sonnet/g", "/sonnet/y", "/^(?!.*haiku).*$/gi"])("is deterministic for stateful regex %s", (query) => {
    const parsed = parseSearchQuery(query);
    for (let i = 0; i < 5; i++) expect(matchesSearch("sonnet", parsed)).toBe(true);
  });

  it("fails malformed regex to literal matching without throwing", () => {
    expect(parseSearchQuery("/[broken/").isRegex).toBe(false);
    expect(matchesSearch("/[broken/", "/[broken/")).toBe(true);
    expect(parseSearchQuery("/sonnet/ii").isRegex).toBe(false);
  });

  it("does not reactivate disabled no-auth providers or mishandle special keys", () => {
    expect([...getDeactivatedProviderIds([
      { provider: "opencode", isActive: false },
      { provider: "codex", isActive: false },
      { provider: "codex" },
      { provider: "__proto__", isActive: false },
      null,
    ])]).toEqual(["opencode", "__proto__"]);
    expect(getDeactivatedProviderIds(null).size).toBe(0);
  });

  const models = [
    { id: "sonnet", value: "ag/sonnet" },
    { id: "haiku", value: "ag/haiku" },
  ];
  const connection = (enabledModels, isActive = true) => ({ isActive, providerSpecificData: { enabledModels } });

  it("unions restricted active accounts but ignores disabled accounts", () => {
    expect(filterEnabledModels(models, [connection(["sonnet"]), connection(["ag/haiku"])], "ag")).toEqual(models);
    expect(filterEnabledModels(models, [connection(["ag/sonnet"]), connection(["haiku"], false)], "ag")).toEqual([models[0]]);
  });

  it("an unrestricted active account keeps the full catalog available", () => {
    expect(filterEnabledModels(models, [connection(["sonnet"]), connection([])], "ag")).toBe(models);
    expect(filterEnabledModels(models, [connection(["sonnet"]), connection(undefined)], "ag")).toBe(models);
  });
});

describe("basic picker integration guardrails", () => {
  const picker = source("src/shared/components/ModelSelectModal.js");
  it("keeps removed providers and custom compatible nodes unavailable", () => {
    expect(picker).toContain('if (!AI_PROVIDERS[providerId]) return;');
    expect(picker).toContain('["antigravity", "codex", "opencode"].includes(providerId)');
    expect(picker).toContain("const isCustomProvider = false;");
    expect(picker).not.toContain("compatibleNodeIds");
  });
  it("refreshes connections with cancellation and excludes placeholders from batch actions", () => {
    expect(picker).toContain('useModalResource(isOpen, "/api/providers", "connections", null)');
    expect(picker).toContain('fetch(request.url, { cache: "no-store", signal: controller.signal })');
    expect(picker).toContain("return () => controller.abort();");
    expect(picker).toContain("if (!controller.signal.aborted) setResult");
    expect(picker).toContain("!deactivatedProviderIds.has(id)");
    expect(picker).toContain("if (!m.isPlaceholder)");
    expect(picker).toContain("onSelectBatch(visibleUnadded)");
    expect(picker).toContain("onDeselectBatch(visibleAdded)");
  });
  it("wires atomic batch updates in both combo forms and the capacity pool", () => {
    const form = source("src/shared/components/ComboFormModal.js");
    const dashboard = source("src/app/(dashboard)/dashboard/combos/page.js");
    for (const src of [form, dashboard]) {
      expect(src).toContain("onSelectBatch=");
      expect(src).toContain("onDeselectBatch=");
      expect(src).toContain("setModels((prev)");
    }
    expect(dashboard).toContain("patch({ models: [...new Set([...models, ...items.map((m) => m.value)])] })");
  });
  it("supports compact buttons without changing the default icon size", () => {
    const button = source("src/shared/components/Button.js");
    expect(button).toContain('xs: "h-6 px-2.5');
    expect(button).toContain('size === "xs" ? "text-[14px]" : "text-[18px]"');
  });
  it("keeps wildcard selection opt-in until a caller can consume provider patterns", () => {
    expect(picker).toContain("allowProviderWildcard = false");
    expect(picker).toContain('const wildcardValue = `${group.alias || providerId}/*`;');
  });
  it("portals tooltips outside clipping ancestors and dismisses stale coordinates", () => {
    const tooltip = source("src/shared/components/Tooltip.js");
    expect(tooltip).toContain("createPortal(");
    expect(tooltip).toContain("document.body");
    expect(tooltip).toContain('position: "fixed"');
    expect(tooltip).toContain('role="tooltip"');
    expect(tooltip).toContain("onFocus={handleMouseEnter}");
    expect(tooltip).toContain('window.addEventListener("scroll", hide, true)');
    expect(tooltip).toContain('window.removeEventListener("scroll", hide, true)');
    expect(tooltip).toContain('window.removeEventListener("resize", hide)');
  });
});
