import { platform, arch } from "os";
import { ANTIGRAVITY_OAUTH_CLIENT } from "open-sse/providers/shared.js";
import { PROVIDER_OAUTH } from "open-sse/providers/index.js";

function getOAuthPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? 2 : 1;
  if (os === "linux") return architecture === "arm64" ? 4 : 3;
  if (os === "win32") return 5;
  return 0;
}

export const CODEX_CONFIG = { ...PROVIDER_OAUTH["codex"] };

export const ANTIGRAVITY_CONFIG = {
  ...ANTIGRAVITY_OAUTH_CLIENT,
  ...PROVIDER_OAUTH["antigravity"],
  loadCodeAssistClientMetadata: JSON.stringify({ ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }),
};

export function getOAuthClientMetadata() {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 };
}

export const OAUTH_TIMEOUT = 300000;

export const PROVIDERS = { CODEX: "codex", ANTIGRAVITY: "antigravity" };
