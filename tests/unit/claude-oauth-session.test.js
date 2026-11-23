import { describe, it, expect, vi } from "vitest";
vi.mock("@/models", () => ({ createProviderConnection: vi.fn(async () => ({ id: "1", provider: "claude" })) }));
vi.mock("@/lib/oauth/utils/server", () => ({ startCodexProxy: vi.fn(), stopCodexProxy: vi.fn(), registerCodexSession: vi.fn(), getCodexSessionStatus: vi.fn(), clearCodexSession: vi.fn() }));
import { NextRequest } from "next/server";
import { GET, POST } from "../../src/app/api/oauth/[provider]/[action]/route.js";
const params = (action) => ({ params: Promise.resolve({ provider: "claude", action }) });
async function begin() {
  const response = await GET(new NextRequest("http://localhost/api/oauth/claude/authorize?redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback"), params("authorize"));
  return { data: await response.json(), cookie: response.cookies.get("claude_oauth_attempt").value };
}
async function exchange(data, cookie, overrides = {}) {
  return POST(new NextRequest("http://localhost/api/oauth/claude/exchange", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie: `claude_oauth_attempt=${cookie}` } : {}) }, body: JSON.stringify({ code: "code", redirectUri: data.redirectUri, codeVerifier: data.codeVerifier, state: data.state, ...overrides }) }), params("exchange"));
}
describe("Claude OAuth attempt binding", () => {
  it("rejects missing browser cookie and mismatched attempt, without token exchange", async () => {
    const first = await begin(); const second = await begin();
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      expect((await exchange(first.data)).status).toBe(400);
      expect((await exchange(first.data, second.cookie)).status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it("accepts the bound attempt once and rejects replay", async () => {
    const attempt = await begin();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh" }), { status: 200 }));
    try {
      expect((await exchange(attempt.data, attempt.cookie)).status).toBe(200);
      expect((await exchange(attempt.data, attempt.cookie)).status).toBe(400);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { fetcher.mockRestore(); }
  });
});
