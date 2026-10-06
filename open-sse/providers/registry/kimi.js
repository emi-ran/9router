import { CLAUDE_API_HEADERS } from "../shared.js";

// Dual auth (same pattern as xai): OAuth = Kimi Code subscription (device code),
// API key = platform.moonshot / api.kimi.com. Transport is shared.
// CLIProxyAPI parity: client_id, auth.kimi.com device+token, X-Msh-* headers, device_id.
export default {
  id: "kimi",
  priority: 170,
  alias: "kimi",
  // Legacy id + short alias from former kimi-coding registry entry
  aliases: ["kimi-coding", "kmc"],
  display: {
    name: "Kimi",
    icon: "psychology",
    color: "#1E3A8A",
    textIcon: "KM",
    website: "https://kimi.moonshot.cn",
    notice: {
      apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
      signupUrl: "https://www.kimi.com/code",
    },
  },
  category: "apikey",

  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.

  models: [
    // Flagship K3 — platform.kimi.ai id `kimi-k3`, Kimi Code OAuth id `k3` (up to 1M)

    // Kimi Code subscription stable ids (map to K2.7 Code backend)

    // Pay-as-you-go platform ids

  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "kimi-k3",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    pricingUrl: "https://platform.kimi.ai/docs/pricing/chat",
  },

};
