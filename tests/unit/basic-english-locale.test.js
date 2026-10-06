import { describe, it, expect } from "vitest";
import { LOCALES, normalizeLocale, isSupportedLocale } from "../../src/i18n/config.js";
import { translate, getCurrentLocale } from "../../src/i18n/runtime.js";
import fs from "node:fs";

describe("English-only runtime", () => {
  it("falls back for unsupported stored cookie/path values without translation fetch", () => {
    expect(LOCALES).toEqual(["en"]);
    for (const locale of ["en", "tr", "vi", "zh-CN", "%invalid", undefined, "/tr/dashboard"]) {
      expect(normalizeLocale(locale)).toBe("en");
      expect(isSupportedLocale(locale)).toBe(locale === "en");
    }
    expect(getCurrentLocale()).toBe("en");
    expect(translate("Account settings")).toBe("Account settings");
  });
  it("keeps English HTML and removes language controls without removing theme provider", () => {
    const layout = fs.readFileSync(new URL("../../src/app/layout.js", import.meta.url), "utf8");
    expect(layout).toContain('lang="en"');
    expect(layout).toContain("<ThemeProvider>");
    for (const file of ["Header.js", "index.js"]) {
      const text = fs.readFileSync(new URL(`../../src/shared/components/${file}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/HeaderLanguage|LanguageSwitcher/);
    }
    const header = fs.readFileSync(new URL("../../src/shared/components/Header.js", import.meta.url), "utf8");
    expect(header).not.toMatch(/DonateModal|donateOpen|aria-label="Donate"/);
  });
  it("does not reactivate MITM from legacy settings on startup", () => {
    const text = fs.readFileSync(new URL("../../src/shared/services/initializeApp.js", import.meta.url), "utf8");
    expect(text).not.toMatch(/mitmEnabled|startMitm|restoreToolDNS|removeAllDNSEntries|bootstrapMitm/);
    expect(text).toContain("configureTunnelMonitoring(settings)");
  });
});
