import { describe, it, expect, vi } from "vitest";
import { getCodexUsage } from "../../open-sse/services/usage/codex.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

async function usage(data) {
  proxyAwareFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
  return getCodexUsage("token");
}

describe("Codex quota window durations", () => {
  it("classifies a weekly primary as weekly without inventing a backend session", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 32, limit_window_seconds: 604800, reset_at: 2000000000 } } });
    expect(result.quotas.session).toBeUndefined();
    expect(result.quotas.weekly).toMatchObject({ used: 32, remaining: 68 });
  });

  it("preserves normal and missing-metadata positional windows without using reset countdowns", async () => {
    for (const metadata of [true, false]) {
      const result = await usage({ rate_limit: {
        primary_window: { used_percent: 12, reset_at: 2000600000, ...(metadata ? { limit_window_seconds: 18000 } : {}) },
        secondary_window: { used_percent: 65, reset_at: 2000000001, ...(metadata ? { limit_window_seconds: 604800 } : {}) },
      } });
      expect(result.quotas.session.used).toBe(12);
      expect(result.quotas.weekly.used).toBe(65);
      expect(parseQuotaData("codex", result).filter((q) => q.quotaType === "session")).toHaveLength(1);
    }
  });

  it("classifies swapped windows and preserves review and spark separately", async () => {
    const weekly = { used_percent: 33, limit_window_seconds: 604800 };
    const session = { used_percent: 17, limit_window_seconds: 18000 };
    const result = await usage({ rate_limit: { primary_window: weekly, secondary_window: session }, code_review_rate_limit: { primary_window: weekly }, spark_rate_limit: { primary_window: session, secondary_window: weekly } });
    expect(result.quotas).toMatchObject({ session: { used: 17 }, weekly: { used: 33 }, review_weekly: { used: 33 }, spark_session: { used: 17 }, spark_weekly: { used: 33 } });
    expect(result.quotas.review_session).toBeUndefined();
  });

  it("retains a durationless secondary when the primary explicitly reports weekly", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 33, limit_window_seconds: 604800 }, secondary_window: { used_percent: 17 } } });
    expect(result.quotas.weekly.used).toBe(33);
    expect(result.quotas.secondary_unknown.used).toBe(17);
    expect(result.quotas.session).toBeUndefined();
    expect(parseQuotaData("codex", result).find((q) => q.quotaType === "secondary_unknown").name).toBe("Secondary (duration unknown)");
  });

  it("preserves a durationless primary when the secondary explicitly reports session", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 40 }, secondary_window: { used_percent: 20, limit_window_seconds: 18000 } } });
    expect(result.quotas.session.used).toBe(20);
    expect(result.quotas.primary_unknown.used).toBe(40);
    expect(result.quotas.weekly).toBeUndefined();
  });

  it("does not classify an explicitly unfamiliar duration by position", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 40, limit_window_seconds: 3600 } } });
    expect(result.quotas.primary_unknown.used).toBe(40);
    expect(result.quotas.session).toBeUndefined();
  });

  it("retains duplicate explicit weekly windows without calling either a session", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 33, limit_window_seconds: 604800 }, secondary_window: { used_percent: 17, limit_window_seconds: 604800 } } });
    expect(result.quotas.weekly.used).toBe(33);
    expect(result.quotas.weekly_secondary.used).toBe(17);
    expect(result.quotas.session).toBeUndefined();
  });

  it("orders the real session before weekly even when the input is swapped", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 33, limit_window_seconds: 604800 }, secondary_window: { used_percent: 17, limit_window_seconds: 18000 } } });
    expect(parseQuotaData("codex", result).map((q) => q.quotaType)).toEqual(["session", "weekly"]);
  });

  it("shows an explicitly inferred 5h placeholder only in dashboard normalization", async () => {
    const result = await usage({ rate_limit: { primary_window: { used_percent: 32, limit_window_seconds: 604800 } } });
    const rows = parseQuotaData("codex", result);
    expect(rows.find((q) => q.quotaType === "session")).toMatchObject({ name: "5h (assumed; not reported)", used: 0, total: 100, remaining: 100, resetAt: null, inferred: true });
    expect(result.quotas.session).toBeUndefined();
  });
});
