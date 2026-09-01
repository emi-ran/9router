import { describe, it, expect } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  rotateRefreshToken,
  setLoginCookies,
  TOKEN_TYPE_ACCESS,
  TOKEN_TYPE_REFRESH,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  handleGuardSession,
} from "../../src/mine/auth/rememberMe.js";
import {
  createDashboardAuthToken,
  getDashboardAuthSession,
  verifyDashboardAuthToken,
  getJwtSecret,
  setDashboardAuthCookie,
} from "../../src/lib/auth/dashboardSession.js";

const TEST_SECRET = new TextEncoder().encode("test-secret-key-12345678901234567890");

describe("Remember Me Authentication Core", () => {
  it("creates access token with token_type=access and 24h expiration", async () => {
    const token = await createAccessToken(TEST_SECRET, { userId: "user-123" });
    expect(token).toBeDefined();

    const { payload } = await jwtVerify(token, TEST_SECRET);
    expect(payload.token_type).toBe(TOKEN_TYPE_ACCESS);
    expect(payload.authenticated).toBe(true);
    expect(payload.userId).toBe("user-123");

    const lifetimeSec = payload.exp - payload.iat;
    expect(lifetimeSec).toBeGreaterThanOrEqual(86300);
    expect(lifetimeSec).toBeLessThanOrEqual(86400);
  });

  it("creates refresh token with token_type=refresh and 7d expiration", async () => {
    const token = await createRefreshToken(TEST_SECRET, { userId: "user-123" });
    expect(token).toBeDefined();

    const { payload } = await jwtVerify(token, TEST_SECRET);
    expect(payload.token_type).toBe(TOKEN_TYPE_REFRESH);
    expect(payload.authenticated).toBe(true);
    expect(payload.userId).toBe("user-123");

    const lifetimeSec = payload.exp - payload.iat;
    expect(lifetimeSec).toBeGreaterThanOrEqual(604700);
    expect(lifetimeSec).toBeLessThanOrEqual(604800);
  });

  it("createDashboardAuthToken cannot have token_type overridden via claims", async () => {
    const token = await createDashboardAuthToken({ authenticated: false, token_type: "refresh", userId: "u1" });
    const session = await getDashboardAuthSession(token);
    expect(session).not.toBeNull();
    expect(session.authenticated).toBe(true);
    expect(session.token_type).toBe(TOKEN_TYPE_ACCESS);
  });

  it("getDashboardAuthSession rejects direct refresh tokens", async () => {
    const refreshToken = await createRefreshToken(getJwtSecret(), { userId: "user-123" });
    const session = await getDashboardAuthSession(refreshToken);
    expect(session).toBeNull();

    const customInvalidToken = await new SignJWT({ authenticated: true, token_type: "custom_type" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getJwtSecret());
    expect(await getDashboardAuthSession(customInvalidToken)).toBeNull();
  });

  it("getDashboardAuthSession accepts legacy tokens without explicit token_type", async () => {
    const legacyToken = await new SignJWT({ authenticated: true, userId: "legacy-user" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getJwtSecret());

    const session = await getDashboardAuthSession(legacyToken);
    expect(session).not.toBeNull();
    expect(session.userId).toBe("legacy-user");
  });

  it("verifyDashboardAuthToken rejects refresh tokens", async () => {
    const refreshToken = await createRefreshToken(getJwtSecret(), { userId: "user-123" });
    expect(await verifyDashboardAuthToken(refreshToken)).toBe(false);
  });

  it("verifyAccessToken rejects refresh tokens and verifies access tokens", async () => {
    const accessToken = await createAccessToken(TEST_SECRET, { userId: "user-123" });
    expect(await verifyAccessToken(TEST_SECRET, accessToken)).toBe(true);

    const refreshToken = await createRefreshToken(TEST_SECRET, { userId: "user-123" });
    expect(await verifyAccessToken(TEST_SECRET, refreshToken)).toBe(false);
  });

  it("expired or invalid tokens fail closed", async () => {
    const invalidToken = "invalid.token.here";
    expect(await verifyAccessToken(TEST_SECRET, invalidToken)).toBe(false);
    expect(await verifyRefreshToken(TEST_SECRET, invalidToken)).toBeNull();

    const wrongSecret = new TextEncoder().encode("different-secret-1234567890123456");
    const validTokenWithOtherSecret = await createAccessToken(wrongSecret, { userId: "user-123" });
    expect(await verifyAccessToken(TEST_SECRET, validTokenWithOtherSecret)).toBe(false);
    expect(await verifyRefreshToken(TEST_SECRET, validTokenWithOtherSecret)).toBeNull();
  });

  it("rotates refresh token and preserves identity claims", async () => {
    const originalRefreshToken = await createRefreshToken(TEST_SECRET, {
      userId: "user-123",
      role: "admin",
      customClaim: "custom-val",
    });

    const rotation = await rotateRefreshToken(TEST_SECRET, originalRefreshToken, true);
    expect(rotation.rotated).toBe(true);
    expect(rotation.newAccessToken).toBeDefined();
    expect(rotation.newRefreshToken).toBeDefined();
    expect(rotation.claims.userId).toBe("user-123");
    expect(rotation.claims.role).toBe("admin");
    expect(rotation.claims.customClaim).toBe("custom-val");

    expect(await verifyAccessToken(TEST_SECRET, rotation.newAccessToken)).toBe(true);
    const newRefreshPayload = await verifyRefreshToken(TEST_SECRET, rotation.newRefreshToken);
    expect(newRefreshPayload).not.toBeNull();
    expect(newRefreshPayload.userId).toBe("user-123");
  });

  it("setLoginCookies sets 1d access and 7d refresh cookie when rememberMe is true", async () => {
    const cookiesSet = [];
    const cookiesDeleted = [];
    const mockCookieStore = {
      set(name, value, options) {
        cookiesSet.push({ name, value, options });
      },
      delete(name) {
        cookiesDeleted.push(name);
      },
    };

    await setLoginCookies(mockCookieStore, {}, TEST_SECRET, { userId: "u1" }, true);

    expect(cookiesSet.length).toBe(2);
    const accessCookie = cookiesSet.find((c) => c.name === ACCESS_TOKEN_COOKIE);
    const refreshCookie = cookiesSet.find((c) => c.name === REFRESH_TOKEN_COOKIE);

    expect(accessCookie).toBeDefined();
    expect(accessCookie.options.maxAge).toBe(ACCESS_TOKEN_MAX_AGE);
    expect(accessCookie.options.httpOnly).toBe(true);
    expect(accessCookie.options.sameSite).toBe("lax");

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie.options.maxAge).toBe(REFRESH_TOKEN_MAX_AGE);
    expect(refreshCookie.options.httpOnly).toBe(true);
    expect(refreshCookie.options.sameSite).toBe("lax");
  });

  it("setLoginCookies sets session access cookie and deletes refresh cookie when rememberMe is false", async () => {
    const cookiesSet = [];
    const cookiesDeleted = [];
    const mockCookieStore = {
      set(name, value, options) {
        cookiesSet.push({ name, value, options });
      },
      delete(name) {
        cookiesDeleted.push(name);
      },
    };

    await setLoginCookies(mockCookieStore, {}, TEST_SECRET, { userId: "u1" }, false);

    expect(cookiesSet.length).toBe(1);
    const accessCookie = cookiesSet[0];
    expect(accessCookie.name).toBe(ACCESS_TOKEN_COOKIE);
    expect(accessCookie.options.maxAge).toBeUndefined();
    expect(cookiesDeleted).toContain(REFRESH_TOKEN_COOKIE);
  });

  it("non-remember SSO sessions clear any existing refresh cookie", async () => {
    const cookiesDeleted = [];
    const mockCookieStore = {
      set() {},
      delete(name) {
        cookiesDeleted.push(name);
      },
    };

    await setDashboardAuthCookie(mockCookieStore, {}, { oidc: true });

    expect(cookiesDeleted).toContain(REFRESH_TOKEN_COOKIE);
  });

  it("handleGuardSession authenticates with valid access token without rotating", async () => {
    const accessToken = await createAccessToken(TEST_SECRET, { userId: "u1" });
    const mockRequest = {
      cookies: {
        get(name) {
          if (name === ACCESS_TOKEN_COOKIE) return { value: accessToken };
          return undefined;
        },
      },
    };

    const session = await handleGuardSession(mockRequest, TEST_SECRET);
    expect(session.authenticated).toBe(true);
    expect(session.rotated).toBe(false);
  });

  it("handleGuardSession slides a valid remember-me session on active access", async () => {
    const accessToken = await createAccessToken(TEST_SECRET, { userId: "u1" });
    const now = Math.floor(Date.now() / 1000);
    const originalRefreshToken = await new SignJWT({
      authenticated: true,
      userId: "u1",
      token_type: TOKEN_TYPE_REFRESH,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now - 3600)
      .setExpirationTime(now + 3600)
      .sign(TEST_SECRET);
    const mockRequest = {
      cookies: {
        get(name) {
          if (name === ACCESS_TOKEN_COOKIE) return { value: accessToken };
          if (name === REFRESH_TOKEN_COOKIE) return { value: originalRefreshToken };
          return undefined;
        },
      },
      headers: {
        get() { return null; },
      },
    };

    const session = await handleGuardSession(mockRequest, TEST_SECRET);
    expect(session.authenticated).toBe(true);
    expect(session.rotated).toBe(true);
    expect(session.newAccessToken).toBeDefined();
    expect(session.newRefreshToken).toBeDefined();

    const newRefreshPayload = await verifyRefreshToken(TEST_SECRET, session.newRefreshToken);
    expect(newRefreshPayload).not.toBeNull();
    expect(newRefreshPayload.userId).toBe("u1");
    expect(newRefreshPayload.exp - newRefreshPayload.iat).toBeGreaterThanOrEqual(REFRESH_TOKEN_MAX_AGE - 1);
    expect(newRefreshPayload.exp - newRefreshPayload.iat).toBeLessThanOrEqual(REFRESH_TOKEN_MAX_AGE);
  });

  it("handleGuardSession keeps valid access when refresh token is invalid", async () => {
    const accessToken = await createAccessToken(TEST_SECRET, { userId: "u1" });
    const mockRequest = {
      cookies: {
        get(name) {
          if (name === ACCESS_TOKEN_COOKIE) return { value: accessToken };
          if (name === REFRESH_TOKEN_COOKIE) return { value: "invalid.refresh.token" };
          return undefined;
        },
      },
    };

    const session = await handleGuardSession(mockRequest, TEST_SECRET);
    expect(session).toEqual({ authenticated: true, rotated: false });
  });

  it("handleGuardSession seamlessly rotates when access token is missing but refresh token is valid", async () => {
    const refreshToken = await createRefreshToken(TEST_SECRET, { userId: "u1" });
    const mockRequest = {
      cookies: {
        get(name) {
          if (name === ACCESS_TOKEN_COOKIE) return undefined;
          if (name === REFRESH_TOKEN_COOKIE) return { value: refreshToken };
          return undefined;
        },
      },
      headers: {
        get() { return null; },
      },
    };

    const session = await handleGuardSession(mockRequest, TEST_SECRET);
    expect(session.authenticated).toBe(true);
    expect(session.rotated).toBe(true);
    expect(session.newAccessToken).toBeDefined();
    expect(session.newRefreshToken).toBeDefined();
    expect(session.cookieOptions.access.maxAge).toBe(ACCESS_TOKEN_MAX_AGE);
    expect(session.cookieOptions.refresh.maxAge).toBe(REFRESH_TOKEN_MAX_AGE);
  });

  it("handleGuardSession fails closed when both tokens are missing or invalid", async () => {
    const mockRequest = {
      cookies: {
        get() { return undefined; },
      },
    };

    const session = await handleGuardSession(mockRequest, TEST_SECRET);
    expect(session.authenticated).toBe(false);
    expect(session.rotated).toBe(false);
  });

  it("clears all auth cookies on logout", async () => {
    const cookiesDeleted = [];
    const mockCookieStore = {
      delete(cookie) {
        cookiesDeleted.push(cookie);
      },
    };

    const { clearAllAuthCookies } = await import("../../src/mine/auth/rememberMe.js");
    clearAllAuthCookies(mockCookieStore);
    expect(cookiesDeleted).toEqual([
      { name: ACCESS_TOKEN_COOKIE, path: "/" },
      { name: REFRESH_TOKEN_COOKIE, path: "/" },
    ]);
  });

  it("end-to-end cookie jar lifecycle: remember-me login sets both tokens, logout revokes both", async () => {
    const cookieJar = new Map();
    const mockCookieStore = {
      get: (name) => {
        const val = cookieJar.get(name);
        return val !== undefined ? { name, value: val } : undefined;
      },
      set: (name, value, options) => {
        cookieJar.set(name, { value, options });
      },
      delete: (cookie) => {
        const name = typeof cookie === "string" ? cookie : cookie.name;
        cookieJar.delete(name);
      },
    };

    // 1. Initial login with rememberMe = true
    await setLoginCookies(mockCookieStore, {}, TEST_SECRET, { userId: "user-test" }, true);
    expect(cookieJar.has(ACCESS_TOKEN_COOKIE)).toBe(true);
    expect(cookieJar.has(REFRESH_TOKEN_COOKIE)).toBe(true);

    const accessEntry = cookieJar.get(ACCESS_TOKEN_COOKIE);
    const refreshEntry = cookieJar.get(REFRESH_TOKEN_COOKIE);
    expect(accessEntry.options.path).toBe("/");
    expect(refreshEntry.options.path).toBe("/");

    // 2. Guard session authenticates
    const mockReq = {
      cookies: {
        get: (name) => {
          const entry = cookieJar.get(name);
          return entry ? { value: entry.value } : undefined;
        },
      },
      headers: { get: () => null },
    };
    const activeSession = await handleGuardSession(mockReq, TEST_SECRET);
    expect(activeSession.authenticated).toBe(true);

    // 3. Complete logout revokes both tokens
    const { clearAllAuthCookies } = await import("../../src/mine/auth/rememberMe.js");
    clearAllAuthCookies(mockCookieStore);
    expect(cookieJar.has(ACCESS_TOKEN_COOKIE)).toBe(false);
    expect(cookieJar.has(REFRESH_TOKEN_COOKIE)).toBe(false);

    // 4. Guard session fails closed
    const unauthedReq = {
      cookies: {
        get: (name) => {
          const entry = cookieJar.get(name);
          return entry ? { value: entry.value } : undefined;
        },
      },
      headers: { get: () => null },
    };
    const postLogoutSession = await handleGuardSession(unauthedReq, TEST_SECRET);
    expect(postLogoutSession.authenticated).toBe(false);
  });
});
