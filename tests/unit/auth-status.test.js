import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
    cookies: mocks.responseCookies,
  })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  isOidcConfigured: vi.fn(),
  getDashboardAuthSession: vi.fn(),
  handleGuardSession: vi.fn(),
  responseCookies: { set: vi.fn() },
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/auth/oidc", () => ({
  isOidcConfigured: mocks.isOidcConfigured,
}));

vi.mock("@/lib/auth/saml.js", () => ({
  isSamlConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  getDashboardAuthSession: mocks.getDashboardAuthSession,
}));

vi.mock("@/mine/auth/rememberMe", () => ({
  ACCESS_TOKEN_COOKIE: "auth_token",
  REFRESH_TOKEN_COOKIE: "refresh_token",
  handleGuardSession: mocks.handleGuardSession,
}));

const { GET } = await import("../../src/app/api/auth/status/route.js");

describe("GET /api/auth/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true, authMode: "password" });
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.handleGuardSession.mockResolvedValue({ authenticated: false, rotated: false });
  });

  it("reports an authenticated session when the auth cookie is valid", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.handleGuardSession.mockResolvedValue({ authenticated: true, rotated: false });

    const response = await GET();

    expect(response.body.authenticated).toBe(true);
    expect(mocks.getDashboardAuthSession).toHaveBeenCalledWith("session-token");
  });

  it("reports unauthenticated when the auth cookie is invalid", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.body.authenticated).toBe(false);
  });

  it("slides authenticated remember-me sessions and sets rotated cookies", async () => {
    const rotation = {
      authenticated: true,
      rotated: true,
      newAccessToken: "new-access-token",
      newRefreshToken: "new-refresh-token",
      cookieOptions: {
        access: { maxAge: 86400 },
        refresh: { maxAge: 604800 },
      },
    };
    mocks.handleGuardSession.mockResolvedValue(rotation);
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });

    const response = await GET();

    expect(response.body.authenticated).toBe(true);
    expect(mocks.getDashboardAuthSession.mock.calls.length).toBeGreaterThan(0);
    expect(mocks.getDashboardAuthSession.mock.calls[0][0]).toBe("new-access-token");
    expect(response.cookies.set.mock.calls.length).toBe(2);
    expect(response.cookies.set.mock.calls[0][0]).toBe("auth_token");
    expect(response.cookies.set.mock.calls[0][1]).toBe("new-access-token");
    expect(response.cookies.set.mock.calls[1][0]).toBe("refresh_token");
    expect(response.cookies.set.mock.calls[1][1]).toBe("new-refresh-token");
  });

  it("fails closed when status dependencies throw", async () => {
    mocks.getSettings.mockRejectedValue(new Error("database unavailable"));

    const response = await GET();

    expect(response.body.authenticated).toBe(false);
    expect(response.body.requireLogin).toBe(true);
  });
});
