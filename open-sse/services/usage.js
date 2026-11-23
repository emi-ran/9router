import { getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage } from "./usage/codex.js";
export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export async function getUsageForProvider(connection, proxyOptions = null, options = {}) {
  if (connection.provider === "claude") return getClaudeUsage(connection.accessToken, proxyOptions, options);
  if (connection.provider === "codex") return getCodexUsage(connection.accessToken, proxyOptions);
  if (connection.provider === "antigravity") return getAntigravityUsage(connection.accessToken, connection.providerSpecificData, proxyOptions);
  return { message: `Usage API not implemented for ${connection.provider}` };
}
