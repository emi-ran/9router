import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js", import.meta.url), "utf8");
describe("chat-only wildcard picker integration", () => {
  it("enables wildcards only on chat combo forms, not judges or capacity pools", () => {
    for (const path of ["src/shared/components/ComboFormModal.js", "src/app/(dashboard)/dashboard/combos/page.js"]) {
      const form = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
      expect(form.match(/allowProviderWildcard=/g)).toHaveLength(1);
      expect(form).toContain('allowProviderWildcard={(!kindFilter || kindFilter === "llm") && (!combo?.kind || combo.kind === "llm")}');
    }
  });
});

describe("BASIC ConnectionRow proxy portal regression guards", () => {
  it("ports the desktop dropdown to body with fixed, flip-up, bounded positioning", () => {
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toContain("showProxyDropdown && createPortal(");
    expect(source).toContain("document.body");
    expect(source).toContain('position: "fixed"');
    expect(source).toContain("const flipUp = spaceBelow < estimatedHeight && rect.top > spaceBelow");
    expect(source).toContain("maxHeight: Math.max(0, rect.top - 8)");
    expect(source).toContain("maxHeight: Math.max(0, spaceBelow - 8)");
    expect(source).toContain('overflow-y-auto rounded-lg');
  });
  it("uses distinct trigger/menu/mobile refs and cleans up dismissal listeners", () => {
    expect(source.match(/ref=\{proxyDropdownRef\}/g)).toHaveLength(1);
    expect(source).toContain("ref={proxyBtnRef}");
    expect(source).toContain("ref={mobileActionsRef}");
    expect(source).toContain("!proxyBtnRef.current?.contains(e.target)");
    expect(source).toContain('if (e.type === "scroll" && proxyDropdownRef.current?.contains(e.target)) return');
    for (const [target, event, handler, capture] of [["document", "mousedown", "handler", ""], ["document", "keydown", "onKey", ""], ["window", "resize", "close", ""], ["document", "scroll", "close", ", true"]]) {
      expect(source).toContain(`${target}.addEventListener("${event}", ${handler}${capture})`);
      expect(source).toContain(`${target}.removeEventListener("${event}", ${handler}${capture})`);
    }
  });
  it("retains BASIC Codex expiry and mobile actions without upstream scheduling UI", () => {
    expect(source).toContain("chatgptSubscriptionActiveUntil");
    expect(source).toContain("subscriptionDaysRemaining");
    expect(source).toContain('aria-label="More connection actions"');
    expect(source).toContain("showMobileProxyOptions");
    expect(source).not.toMatch(/scheduleConfig|ScheduleModal|onEditSchedule/);
  });
});
