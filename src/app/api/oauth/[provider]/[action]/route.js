
import { NextResponse } from "next/server";
import { generateAuthData, exchangeTokens } from "@/lib/oauth/providers";
import { createProviderConnection } from "@/models";

import { startCodexProxy, stopCodexProxy, registerCodexSession, getCodexSessionStatus, clearCodexSession } from "@/lib/oauth/utils/server";

/**
 * Dynamic OAuth API Route
 * Handles: authorize, exchange, device-code, poll
 */

// GET /api/oauth/[provider]/authorize - Generate auth URL
// GET /api/oauth/[provider]/device-code - Request device code (for device_code flow)
export async function GET(request, { params }) {
  try {
    const { provider, action } = await params;
    if (!["codex", "antigravity"].includes(provider)) return NextResponse.json({ error: "Unsupported OAuth provider" }, { status: 400 });
    const { searchParams } = new URL(request.url);

    if (action === "authorize") {
      // Xiaomi Desktop: custom ECDH flow — generate keypair, start proxy, return authorize URL

      const redirectUri = searchParams.get("redirect_uri") || "http://localhost:8080/callback";
      // Collect provider-specific meta params (e.g. gitlab passes baseUrl, clientId, clientSecret)
      const reservedParams = new Set(["redirect_uri"]);
      const meta = {};
      searchParams.forEach((value, key) => { if (!reservedParams.has(key)) meta[key] = value; });
      // Zed: derive native_app_port from the local callback URL so the RSA keypair
      // is bound to the port the proxy is actually listening on.

      const authData = await generateAuthData(provider, redirectUri, Object.keys(meta).length ? meta : undefined);
      return NextResponse.json(authData);
    }

    if (action === "start-proxy") {
      // Trae/Windsurf/Zed use a dynamic-port local callback server (singleton session,
      // state is registered separately via /register-session after /authorize).

      if (provider !== "codex") {
        return NextResponse.json({ error: "Proxy only supported for codex" }, { status: 400 });
      }
      const appPort = searchParams.get("app_port");
      if (!appPort) {
        return NextResponse.json({ error: "Missing app_port" }, { status: 400 });
      }
      const state = searchParams.get("state");
      const codeVerifier = searchParams.get("code_verifier");
      const redirectUri = searchParams.get("redirect_uri");
      const result = await startCodexProxy(Number(appPort));
      let serverSide = false;
      if (result.success && state && codeVerifier && redirectUri) {
        serverSide = registerCodexSession({ state, codeVerifier, redirectUri });
      }
      return NextResponse.json({ ...result, serverSide });
    }

    if (action === "poll-status") {
      const state = searchParams.get("state");
      if (!state) {
        return NextResponse.json({ error: "Missing state" }, { status: 400 });
      }
      if (provider !== "codex") return NextResponse.json({ error: "Poll only supported for codex" }, { status: 400 });
      const session = getCodexSessionStatus(state);
      if (!session) return NextResponse.json({ status: "unknown" });
      if (session.status === "done" || session.status === "error") {
        const payload = { ...session };

        clearCodexSession(state);
        return NextResponse.json(payload);
      }
      return NextResponse.json({ status: session.status });
    }

    if (action === "stop-proxy") {
      if (provider !== "codex") return NextResponse.json({ error: "Proxy only supported for codex" }, { status: 400 });
      stopCodexProxy();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/oauth/[provider]/exchange - Exchange code for tokens and save
// POST /api/oauth/[provider]/poll - Poll for token (device_code flow)
export async function POST(request, { params }) {
  try {
    const { provider, action } = await params;
    if (!["codex", "antigravity"].includes(provider)) return NextResponse.json({ error: "Unsupported OAuth provider" }, { status: 400 });
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }

    if (action === "exchange") {
      const { code, redirectUri, codeVerifier, state, meta, systemId } = body;

      // Xiaomi MiMo: no token exchange needed — the callback already decrypted the sk.
      // Just read the session result and create the connection.

      // Trae/Windsurf: code is either a raw callback URL or a pasted token.
      // exchangeTokens() handles both paths; no PKCE, skip codex JWT extraction.

      // Detect if "code" is actually a raw JWT access token (starts with eyJ)
      if (code && code.startsWith("eyJ") && code.includes(".")) {
        const { extractCodexAccountInfo } = await import("@/lib/oauth/providers");
        const info = extractCodexAccountInfo(code);

        // Also decode JWT directly for ChatGPT website tokens which use
        // top-level account_id/plan_type instead of nested openai auth claims
        let directPayload = {};
        try {
          const b64 = code.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
          directPayload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        } catch {}

        const accountId = info.chatgptAccountId || directPayload.account_id;
        const planType = info.chatgptPlanType || directPayload.plan_type;
        const subscriptionActiveUntil = info.chatgptSubscriptionActiveUntil;
        const email = info.email || directPayload.email;

        const providerSpecificData = { authMethod: "access_token" };
        if (accountId) providerSpecificData.chatgptAccountId = accountId;
        if (planType) providerSpecificData.chatgptPlanType = planType;
        if (subscriptionActiveUntil) providerSpecificData.chatgptSubscriptionActiveUntil = subscriptionActiveUntil;

        const connection = await createProviderConnection({
          provider,
          authType: "access_token",
          accessToken: code,
          email: email || null,
          providerSpecificData,
          testStatus: "active",
        });

        return NextResponse.json({
          success: true,
          connection: {
            id: connection.id,
            provider: connection.provider,
            email: connection.email,
            displayName: connection.displayName,
          }
        });
      }

      // Cline and ClinePass use authorization_code without PKCE. Kimchi returns a browser token.
      const noPkceExchangeProviders = ["cline", "clinepass", "kimchi"];
      if (!code || !redirectUri || (!codeVerifier && !noPkceExchangeProviders.includes(provider))) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      // Exchange code for tokens (meta carries provider-specific params, e.g. gitlab clientId/baseUrl).
      // systemId (Zed) is merged into meta so the login attempt's own id is
      // used instead of a freshly prepared one. Ignored by other providers.
      const tokenData = await exchangeTokens(provider, code, redirectUri, codeVerifier, state, {
        ...(meta || {}),
        ...(systemId ? { systemId } : {}),
      });

      // Save to database
      const connection = await createProviderConnection({
        provider,
        authType: "oauth",
        ...tokenData,
        expiresAt: tokenData.expiresIn
          ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
          : null,
        testStatus: "active",
      });

      return NextResponse.json({
        success: true,
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          displayName: connection.displayName,
        }
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
