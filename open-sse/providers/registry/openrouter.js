export default {
  id: "openrouter",
  priority: 10,
  hasFree: true,
  alias: "openrouter",
  display: {
    name: "OpenRouter",
    icon: "router",
    color: "#F97316",
    textIcon: "OR",
    website: "https://openrouter.ai",
    notice: {
      text: "Free tier: 27+ free models, no credit card needed, 200 req/day. After  0 credit: 1,000 req/day.",
      apiKeyUrl: "https://openrouter.ai/settings/keys",
    },
  },
  category: "apikey",
  authType: "apikey",

  models: [

  ],
  serviceKinds: ["imageToText"],
  // System One decision API (TypeSafe-compatible): https://openrouter.ai/docs/guides/community/typesafe-sdk

  imageConfig: {
    baseUrl: "https://openrouter.ai/api/v1/images/generations",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  // Async video jobs (POST /videos → { id, status }, GET /videos/{id} polls).
  // Docs: https://openrouter.ai/docs/api/api-reference/videos

};
