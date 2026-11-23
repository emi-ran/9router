import { it, expect, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
it("fetches and normalizes Claude OAuth quota for the dashboard", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 35, resets_at: "2026-11-24T00:00:00Z" }, seven_day: { utilization: 70 } }), { status: 200 }));
  try {
    const result = await getUsageForProvider({ provider: "claude", accessToken: "quota-test-token" });
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("claude");
    expect(result.quotas["session (5h)"].remainingPercentage).toBe(65);
    expect(result.quotas["weekly (7d)"].remainingPercentage).toBe(30);
    expect(fetcher.mock.calls[0][0]).toContain("/api/oauth/usage");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer quota-test-token");
  } finally { fetcher.mockRestore(); }
});

it("retries after a transient quota failure", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new Response(JSON.stringify({ five_hour: { utilization: 10 } }), { status: 200 }));
  try {
    await getUsageForProvider({ provider: "claude", accessToken: "transient-token" });
    const result = await getUsageForProvider({ provider: "claude", accessToken: "transient-token" });
    expect(result.quotas["session (5h)"].remainingPercentage).toBe(90);
  } finally { fetcher.mockRestore(); }
});
it("exposes OAuth 401 to trigger credential refresh", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
  try {
    const result = await getUsageForProvider({ provider: "claude", accessToken: "expired-token" });
    expect(result.message).toMatch(/401|expired|unauthorized/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { fetcher.mockRestore(); }
});
