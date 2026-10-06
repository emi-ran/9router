import { getAntigravityUsage } from "./usage/google.js";
import { getCodexUsage } from "./usage/codex.js";
export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export async function getUsageForProvider(connection, proxyOptions = null) {
  if (connection.provider === "codex") return getCodexUsage(connection.accessToken, proxyOptions);
  if (connection.provider === "antigravity") return getAntigravityUsage(connection.accessToken, connection.providerSpecificData, proxyOptions);
  return { message: `Usage API not implemented for ${connection.provider}` };
}
