import "open-sse/utils/proxyFetch.js";
import { generatePKCE } from "../utils/pkce.js";
import { extractCodexAccountInfo } from "../providerHelpers.js";
import codex from "./codex.js";
import antigravity from "./antigravity.js";
const PROVIDERS = { codex, antigravity };
export { PROVIDERS };

// Re-export helpers that other files import from this path
export { extractCodexAccountInfo };

/**
 * Get provider handler
 */
export function getProvider(name) {
  // Legacy kimi-coding → kimi (dual-auth merge)
  const key = name;
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

/**
 * Get all provider names
 */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

/**
 * Generate auth data for a provider
 * @param {object} [meta] - Provider-specific metadata (e.g. gitlab clientId/baseUrl)
 */
export async function generateAuthData(providerName, redirectUri, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;
  const { codeVerifier: pkceVerifier, codeChallenge, state: pkceState } = generatePKCE(provider.pkceVerifierBytes);
  // Trae uses loginTraceID (set by prepareConfig) as the callback matcher, not PKCE state.
  const state = config.loginTraceID || pkceState;
  // Zed: codeVerifier carries the encoded RSA private key (from prepareConfig), not a PKCE verifier.
  const codeVerifier = config.privateKeyVerifier || pkceVerifier;

  let authUrl;
  if (provider.flowType === "device_code") {
    // Device code flow doesn't have auth URL upfront
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
    // Zed: surface the system_id embedded in the sign-in URL so the frontend
    // can thread it through register-session → exchange → stored connection
    // (exchangeTokens re-runs prepareConfig, which would otherwise mint a
    // different one). Absent for every other provider — purely additive.
    ...(config.systemId ? { systemId: config.systemId } : {}),
  };
}

/**
 * Exchange code for tokens
 * @param {object} [meta] - Provider-specific metadata (e.g. gitlab clientId/baseUrl)
 */
export async function exchangeTokens(providerName, code, redirectUri, codeVerifier, state, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;

  const tokens = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

/**
 * Request device code (for device_code flow)
 */

/**
 * Poll for token (for device_code flow)
 * @param {string} providerName - Provider name
 * @param {string} deviceCode - Device code from requestDeviceCode
 * @param {string} codeVerifier - PKCE code verifier (optional for some providers)
 * @param {object} extraData - Extra data from device code response (e.g. clientId/clientSecret for Kiro)
 */

// Run-once guard across the process lifetime
let codexBackfillDone = false;

// Backfill email + chatgpt account info for existing codex OAuth connections missing them
export async function backfillCodexEmails() {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail = !!c.email;
      const hasAccountInfo = !!c.providerSpecificData?.chatgptAccountId;
      const hasSubscriptionExpiry = !!c.providerSpecificData?.chatgptSubscriptionActiveUntil;
      return !hasEmail || !hasAccountInfo || !hasSubscriptionExpiry;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken);
      if (!info.email && !info.chatgptAccountId && !info.chatgptSubscriptionActiveUntil) continue;
      const patch = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType || info.chatgptSubscriptionActiveUntil) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          ...(info.chatgptAccountId ? { chatgptAccountId: info.chatgptAccountId } : {}),
          ...(info.chatgptPlanType ? { chatgptPlanType: info.chatgptPlanType } : {}),
          ...(info.chatgptSubscriptionActiveUntil ? { chatgptSubscriptionActiveUntil: info.chatgptSubscriptionActiveUntil } : {}),
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", err?.message || err);
  }
}
