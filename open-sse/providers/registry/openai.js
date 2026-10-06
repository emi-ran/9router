export default {
  id: "openai",
  priority: 30,
  alias: "openai",
  display: {
    name: "OpenAI",
    icon: "auto_awesome",
    color: "#10A37F",
    textIcon: "OA",
    website: "https://platform.openai.com",
    notice: {
      apiKeyUrl: "https://platform.openai.com/api-keys",
    },
  },
  category: "apikey",

  models: [

    { id: "gpt-image-2.5", name: "GPT Image 2.5", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "gpt-image-1", name: "GPT Image 1", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "dall-e-3", name: "DALL-E 3", params: ["size","quality","style","response_format"], kind: "image" },
    { id: "dall-e-2", name: "DALL-E 2", params: ["n","size","response_format"], kind: "image" },
  ],
  serviceKinds: ["image","imageToText","webSearch"],

  imageConfig: { baseUrl: "https://api.openai.com/v1/images/generations" },
  searchViaChat: { defaultModel: "gpt-4o-mini", pricingUrl: "https://openai.com/api/pricing" },
};
