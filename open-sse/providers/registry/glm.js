import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "glm",
  priority: 140,
  alias: "glm",
  display: {
    name: "Zai GLM Coding",
    icon: "code",
    color: "#2563EB",
    textIcon: "GL",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
      signupUrl: "https://chat.z.ai",
    },
  },
  category: "apikey",
  // Dual-auth like kimi: paste an API key, or OAuth-login with the Z.ai
  // account to auto-mint a coding-plan key.

  // OAuth = ZCode CLI polling flow (apps/zcode-cli cli-oauth.ts) — no PKCE, no
  // local callback: init mints a one-off poll token, the browser authorize_url
  // is server-generated, and poll/ready carries the tokens. The Z.AI OAuth
  // token is exchanged for a business JWT, then a long-lived coding-plan API
  // key (no refresh grant — re-login on expiry, same as the official CLI).

  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.

  models: [

  ],
  serviceKinds: ["webSearch"],
  // Coding plan bundles web search on the same API key as chat.
  searchConfig: {
    baseUrl: "https://api.z.ai/api/mcp/web_search_prime/mcp",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 50,
    timeoutMs: 10000,
    cacheTTLMs: 300000,
  },

};
