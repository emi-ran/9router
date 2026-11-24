import { describe, it, expect } from "vitest";
import { isRetiredSetting, withoutRetiredSettings } from "@/lib/db/repos/settingsRepo.js";

describe("Claude Code auto-ping setting", () => {
  it("is not treated as a retired setting, so the toggle survives a reload", () => {
    expect(isRetiredSetting("claudeAutoPing")).toBe(false);
    const kept = withoutRetiredSettings({ claudeAutoPing: { connections: { a: true } }, rtkEnabled: true });
    expect(kept.claudeAutoPing).toEqual({ connections: { a: true } });
    expect(kept.rtkEnabled).toBeUndefined();
  });
});
