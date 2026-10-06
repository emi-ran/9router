export default {
  id: "venice",
  priority: 115,
  alias: "venice",
  aliases: [
    "vn",
  ],
  uiAlias: "venice",
  display: {
    name: "Venice AI",
    icon: "shield",
    color: "#DC2626",
    textIcon: "VE",
    website: "https://venice.ai",
    notice: {
      text: "OpenAI-compatible. Private inference + uncensored models (Venice Uncensored, GLM, Qwen, DeepSeek, Llama).",
      apiKeyUrl: "https://venice.ai/settings/api",
    },
  },
  category: "apikey",

  // Curated seed; the full live catalogue (90+ text models) is fetched via
  // modelsFetcher and any other id is accepted via passthroughModels.
  models: [

    { id: "venice-sd35", name: "Venice SD3.5", params: ["n", "size"], kind: "image" },
    { id: "flux-2-pro", name: "FLUX.2 Pro", params: ["n", "size"], kind: "image" },
    { id: "gpt-image-2", name: "GPT Image 2 (via Venice)", params: ["n", "size", "quality"], kind: "image" },
  ],
  serviceKinds: ["image"],

  imageConfig: {
    baseUrl: "https://api.venice.ai/api/v1/images/generations",
  },

};
