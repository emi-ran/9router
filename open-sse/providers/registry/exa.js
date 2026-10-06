export default {
  id: "exa",
  alias: "exa",
  display: {
    name: "Exa",
    icon: "manage_search",
    color: "#2563EB",
    textIcon: "EX",
    website: "https://exa.ai",
    notice: {
      apiKeyUrl: "https://dashboard.exa.ai/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: ["webSearch"],
  searchConfig: {
    baseUrl: "https://api.exa.ai/search",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0.007,
    freeMonthlyQuota: 1000,
    searchTypes: [
      "web",
      "news"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 10000,
    cacheTTLMs: 300000
  },

};
