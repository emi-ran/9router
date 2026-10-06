import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { handleGuardSession, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/mine/auth/rememberMe";

export async function GET(request = null) {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const guardSession = await handleGuardSession({
      cookies: cookieStore,
      headers: request?.headers,
    });
    const sessionToken = guardSession.rotated
      ? guardSession.newAccessToken
      : cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
    const session = guardSession.authenticated
      ? await getDashboardAuthSession(sessionToken)
      : null;

    const requireLogin = settings.requireLogin !== false;
    const response = NextResponse.json({
      requireLogin,
      authMode: "password",
      hasPassword: !!settings.password,
      displayName: "Password user",
      loginMethod: "Password",
      authenticated: !!session,
    });

    if (guardSession.rotated && guardSession.cookieOptions) {
      response.cookies.set(ACCESS_TOKEN_COOKIE, guardSession.newAccessToken, guardSession.cookieOptions.access);
      response.cookies.set(REFRESH_TOKEN_COOKIE, guardSession.newRefreshToken, guardSession.cookieOptions.refresh);
    }

    return response;
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      hasPassword: false,
      displayName: "Password user",
      loginMethod: "Password",
      authenticated: false,
    });
  }
}
