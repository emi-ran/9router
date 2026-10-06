import { PROVIDERS } from "../config/providers.js";
import { REFRESH_LEAD_MS } from "../config/appConstants.js";
import { refreshGoogleToken, refreshCodexToken } from "./tokenRefresh/providers.js";
export { refreshGoogleToken, refreshCodexToken, classifyOAuthRefreshError } from "./tokenRefresh/providers.js";

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result) {
  return (
    result &&
    typeof result === "object" &&
    (result.error === "unrecoverable_refresh_error" ||
      result.error === "refresh_token_reused" ||
      result.error === "invalid_request" ||
      result.error === "invalid_grant")
  );
}

export async function getAllAccessTokens(userInfo, log) {
  const results = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log);

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (result) return result;
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}

export function getRefreshLeadMs(provider) {
  return REFRESH_LEAD_MS[provider] || TOKEN_EXPIRY_BUFFER_MS;
}

export async function getAccessToken(provider, credentials, log) {
  return refreshTokenByProvider(provider, credentials, log);
}

export async function refreshTokenByProvider(provider, credentials, log) {
  if (!credentials?.refreshToken || typeof credentials.refreshToken !== "string") return null;
  if (provider === "codex") return refreshCodexToken(credentials.refreshToken, log);
  if (provider === "antigravity") {
    return refreshGoogleToken(credentials.refreshToken, PROVIDERS.antigravity.clientId, PROVIDERS.antigravity.clientSecret, log);
  }
  return null;
}

export function formatProviderCredentials(provider, credentials, log) {
  if (!PROVIDERS[provider]) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider: ${provider}`);
    return null;
  }
  return provider === "antigravity"
    ? { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, projectId: credentials.projectId }
    : { apiKey: credentials.apiKey, accessToken: credentials.accessToken, refreshToken: credentials.refreshToken };
}
