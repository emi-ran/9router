export default {
  id: "xai",
  priority: 280,
  alias: "xai",
  display: {
    name: "xAI (Grok)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    notice: {
      apiKeyUrl: "https://console.x.ai",
    },
  },
  category: "apikey",

  models: [

    { id: "grok-2-image-1212", name: "Grok 2 Image", params: ["n","response_format"], kind: "image" },

  ],
  serviceKinds: ["imageToText","webSearch","image"],
  imageConfig: { baseUrl: "https://api.x.ai/v1/images/generations", bodyFields: ["model","prompt","n","response_format"] },
  // Async video jobs (POST returns { request_id }, GET polls until done/failed).
  // Docs: https://docs.x.ai/developers/rest-api-reference/inference/videos

  searchViaChat: {
    defaultModel: "grok-4.20-reasoning",
    endpoint: "https://api.x.ai/v1/responses",
    pricingUrl: "https://x.ai/api#pricing",
  },
};
