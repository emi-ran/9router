export default {
  id: "perplexity-agent",
  priority: 181,
  alias: "perplexity-agent",
  aliases: [
    "pplx-agent",
    "pplx-responses",
  ],
  uiAlias: "pa",
  display: {
    name: "Perplexity Agent",
    icon: "travel_explore",
    color: "#20808D",
    textIcon: "PA",
    website: "https://www.perplexity.ai",
    notice: {
      text: "Perplexity Agent API exposes GPT, Claude, Gemini, Grok, GLM, Kimi, and Sonar models through one OpenAI-compatible Responses API.",
      apiKeyUrl: "https://www.perplexity.ai/settings/api",
    },
  },
  category: "apikey",
  authType: "apikey",

  models: [

  ],
  serviceKinds: ["webSearch"],
  searchViaChat: {
    defaultModel: "perplexity/sonar",
    endpoint: "https://api.perplexity.ai/v1/responses",
    pricingUrl: "https://docs.perplexity.ai/docs/agent-api/models",
  },

};
