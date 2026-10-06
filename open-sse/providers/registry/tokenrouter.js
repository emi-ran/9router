export default {
  id: "tokenrouter",
  alias: "tokenrouter",
  aliases: ["tr"],
  uiAlias: "tokenrouter",
  display: {
    name: "TokenRouter",
    icon: "hub",
    color: "#0EA5E9",
    textIcon: "TR",
    website: "https://www.tokenrouter.com",
    notice: {
      text: "OpenAI-compatible gateway. 300+ models (OpenAI, Claude, Gemini, Qwen, DeepSeek, Kimi, GLM, dsb).",
      apiKeyUrl: "https://www.tokenrouter.com",
    },
  },
  category: "apikey",

  // Seed snapshot from live /v1/models. Latest catalogue is
  // fetched via modelsFetcher; other ids still accepted via passthroughModels.
  models: [

  ],
  serviceKinds: ["image"],

  imageConfig: {
    baseUrl: "https://api.tokenrouter.com/v1/images/generations",
  },

};
