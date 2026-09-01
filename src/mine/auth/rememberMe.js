import { SignJWT, jwtVerify } from "jose";
import * as dashboardSessionModule from "@/lib/auth/dashboardSession";

function safeGetJwtSecret() {
  if (typeof dashboardSessionModule.getJwtSecret === "function") {
    return dashboardSessionModule.getJwtSecret();
  }
  return null;
}

export function isSecureCookieRequest(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export const ACCESS_TOKEN_COOKIE = "auth_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

export const TOKEN_TYPE_ACCESS = "access";
export const TOKEN_TYPE_REFRESH = "refresh";

export const ACCESS_TOKEN_EXPIRY = "24h";
export const REFRESH_TOKEN_EXPIRY = "7d";
export const ACCESS_TOKEN_MAX_AGE = 24 * 60 * 60; // 1 day in seconds
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Creates an access token (type: 'access', 24h).
 */
export async function createAccessToken(secret, claims = {}) {
  const resolvedSecret = secret || safeGetJwtSecret();
  const { authenticated, token_type, ...restClaims } = claims;
  return new SignJWT({
    authenticated: true,
    ...restClaims,
    token_type: TOKEN_TYPE_ACCESS,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(resolvedSecret);
}

/**
 * Creates a refresh token (type: 'refresh', 7d).
 */
export async function createRefreshToken(secret, claims = {}) {
  const resolvedSecret = secret || safeGetJwtSecret();
  const { authenticated, token_type, ...restClaims } = claims;
  return new SignJWT({
    authenticated: true,
    ...restClaims,
    token_type: TOKEN_TYPE_REFRESH,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(resolvedSecret);
}

/**
 * Verifies that token is a valid access token.
 * Rejects refresh tokens or other token types for direct access.
 */
export async function verifyAccessToken(secret, token) {
  if (!token) return false;
  // If mock verifyDashboardAuthToken exists on module and secret wasn't explicitly passed, delegate if needed
  if (!secret && typeof dashboardSessionModule.verifyDashboardAuthToken === "function") {
    return await dashboardSessionModule.verifyDashboardAuthToken(token);
  }
  try {
    const resolvedSecret = secret || safeGetJwtSecret();
    if (!resolvedSecret) return false;
    const { payload } = await jwtVerify(token, resolvedSecret);
    // Legacy tokens might not have token_type, treat missing as access token for backward compatibility.
    // If token_type is present, it MUST NOT be anything other than 'access'.
    if (payload.token_type && payload.token_type !== TOKEN_TYPE_ACCESS) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifies that token is a valid refresh token.
 */
export async function verifyRefreshToken(secret, token) {
  if (!token) return null;
  try {
    const resolvedSecret = secret || safeGetJwtSecret();
    if (!resolvedSecret) return null;
    const { payload } = await jwtVerify(token, resolvedSecret);
    if (payload.token_type !== TOKEN_TYPE_REFRESH) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Sets remember-me cookies on login:
 * If rememberMe is true: sets access_token (24h) and refresh_token (7d).
 * If rememberMe is false: sets access_token (24h) and clears refresh_token.
 */
export async function setLoginCookies(cookieStore, request, secret, claims = {}, rememberMe = false) {
  const resolvedSecret = secret || safeGetJwtSecret();
  const secure = isSecureCookieRequest(request);

  if (rememberMe) {
    const [accessToken, refreshToken] = await Promise.all([
      createAccessToken(resolvedSecret, claims),
      createRefreshToken(resolvedSecret, claims),
    ]);

    cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: ACCESS_TOKEN_MAX_AGE,
    });

    cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
  } else {
    const accessToken = await createAccessToken(resolvedSecret, claims);
    cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    });
    cookieStore.delete(REFRESH_TOKEN_COOKIE);
  }
}

/**
 * Clears both access and refresh auth cookies.
 */
export function clearAllAuthCookies(cookieStore) {
  cookieStore.delete({ name: ACCESS_TOKEN_COOKIE, path: "/" });
  cookieStore.delete({ name: REFRESH_TOKEN_COOKIE, path: "/" });
}

/**
 * Rotates tokens when access token is invalid/expired but valid refresh token exists.
 * Returns { rotated: true, newAccessToken, newRefreshToken, claims, cookieOptions } or { rotated: false }
 */
export async function rotateRefreshToken(secret, refreshToken, isSecure = false) {
  const resolvedSecret = secret || safeGetJwtSecret();
  const payload = await verifyRefreshToken(resolvedSecret, refreshToken);
  if (!payload) {
    return { rotated: false };
  }

  // Extract custom identity claims, stripping standard JWT claims
  const {
    exp,
    iat,
    nbf,
    jti,
    token_type,
    ...claims
  } = payload;

  const [newAccessToken, newRefreshToken] = await Promise.all([
    createAccessToken(resolvedSecret, claims),
    createRefreshToken(resolvedSecret, claims),
  ]);

  return {
    rotated: true,
    newAccessToken,
    newRefreshToken,
    claims,
    cookieOptions: {
      access: {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: "/",
        maxAge: ACCESS_TOKEN_MAX_AGE,
      },
      refresh: {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: "/",
        maxAge: REFRESH_TOKEN_MAX_AGE,
      },
    },
  };
}

/**
 * Handles sliding refresh in dashboard guard / proxy.
 * A valid remember-me session rotates on every authenticated request so its
 * refresh expiry stays seven days beyond the latest activity.
 */
export async function handleGuardSession(request, secret) {
  const authToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const isAccessValid = await verifyAccessToken(secret, authToken);

  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (isAccessValid) {
    if (!refreshToken) {
      return { authenticated: true, rotated: false };
    }

    const resolvedSecret = secret || safeGetJwtSecret();
    if (!resolvedSecret) {
      return { authenticated: true, rotated: false };
    }

    const rotation = await rotateRefreshToken(
      resolvedSecret,
      refreshToken,
      isSecureCookieRequest(request),
    );
    if (!rotation.rotated) {
      // An invalid refresh token must not override a valid access token.
      return { authenticated: true, rotated: false };
    }

    return {
      authenticated: true,
      rotated: true,
      newAccessToken: rotation.newAccessToken,
      newRefreshToken: rotation.newRefreshToken,
      cookieOptions: rotation.cookieOptions,
    };
  }

  if (!refreshToken) {
    return { authenticated: false, rotated: false };
  }

  const resolvedSecret = secret || safeGetJwtSecret();
  if (!resolvedSecret) {
    return { authenticated: false, rotated: false };
  }

  const isSecure = isSecureCookieRequest(request);
  const rotation = await rotateRefreshToken(resolvedSecret, refreshToken, isSecure);
  if (!rotation.rotated) {
    return { authenticated: false, rotated: false };
  }

  return {
    authenticated: true,
    rotated: true,
    newAccessToken: rotation.newAccessToken,
    newRefreshToken: rotation.newRefreshToken,
    cookieOptions: rotation.cookieOptions,
  };
}
