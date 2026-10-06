import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { CODEX_CLI_VERSION } from "open-sse/config/appConstants.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshProviderCredentials } from "open-sse/services/oauthCredentialManager.js";
const OAUTH_TEST_CONFIG = { codex: {
    url: "https://chatgpt.com/backend-api/codex/responses",
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json", "originator": "codex_cli_rs", "User-Agent": `codex_cli_rs/${CODEX_CLI_VERSION}` },
    // Minimal invalid body — triggers fast 400 without consuming quota
    body: JSON.stringify({ model: "gpt-5.3-codex", input: [], stream: false, store: false }),
    // 400 (bad request) means auth succeeded; only 401/403 means token is bad
    acceptStatuses: [400],
    refreshable: true,
  },
antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  } };
export function classifyOAuthProbeResult(res, config, bodyText = "") {
  if (!res) return { valid: false, error: "No response", soft: false };
  const status = res.status;
  const accepted = res.ok || (config?.acceptStatuses && config.acceptStatuses.includes(status));
  if (!accepted) {
    if (status === 401) return { valid: false, error: "Token invalid or revoked", soft: false };
    if (status === 403) return { valid: false, error: "Access denied", soft: false };
    return { valid: false, error: `API returned ${status}`, soft: false };
  }

  // Soft success only when the provider configured an explicit message for this
  // status (e.g. Grok CLI 402 spending-limit). Codex-style acceptStatuses:[400]
  // stays silent success — 400 there only proves auth, not a user-facing warning.
  if (!res.ok && config?.acceptStatuses?.includes(status)) {
    const softMap = config.softFailMessage || {};
    if (softMap[status]) {
      return { valid: true, error: softMap[status], soft: true };
    }
    return { valid: true, error: null, soft: false };
  }

  return { valid: true, error: null, soft: false };
}
export async function testSingleConnection(id) {
  const started = Date.now();
  const connection = await getProviderConnectionById(id);
  if (!connection) return { valid: false, error: "Connection not found" };
  const provider = AI_PROVIDERS[connection.provider];
  if (!provider) return { valid: false, error: "Unsupported provider" };
  let result = { valid: true, error: null, refreshed: false };
  try {
    const cfg = OAUTH_TEST_CONFIG[connection.provider];
    if (cfg) {
      if (!connection.accessToken) result = { valid: false, error: "No access token" };
      else {
        const proxyOptions = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
        const probe = token => proxyAwareFetch(cfg.url, { method: cfg.method, headers: { ...cfg.extraHeaders, [cfg.authHeader]: cfg.authPrefix + token }, body: cfg.body, signal: AbortSignal.timeout(10000) }, proxyOptions);
        let response = await probe(connection.accessToken);
        if ([401, 403].includes(response.status) && connection.refreshToken) {
          const refreshed = await refreshProviderCredentials(connection.provider, connection, console);
          if (refreshed?.accessToken) { await updateProviderConnection(id, refreshed); response = await probe(refreshed.accessToken); result.refreshed = true; }
        }
        result = { ...result, ...classifyOAuthProbeResult(response, cfg, await response.text()) };
      }
    } else if (!provider.noAuth && !connection.apiKey) result = { valid: false, error: "No API key" };
  } catch (error) { result = { valid: false, error: error.message }; }
  await updateProviderConnection(id, { testStatus: result.valid ? "active" : "error", lastError: result.error || null, lastErrorAt: result.valid ? null : new Date().toISOString() });
  return { ...result, latencyMs: Date.now() - started, testedAt: new Date().toISOString() };
}
