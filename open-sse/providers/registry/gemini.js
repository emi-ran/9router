import { GOOGLE_OAUTH_CLIENT } from "../shared.js";

export default {
  id: "gemini",
  priority: 50,
  hasFree: true,
  alias: "gemini",
  display: {
    name: "Gemini",
    icon: "diamond",
    color: "#4285F4",
    textIcon: "GE",
    website: "https://ai.google.dev",
    notice: {
      apiKeyUrl: "https://aistudio.google.com/app/apikey",
    },
  },
  category: "apikey",
  authType: "apikey",

  mediaPriority: 1,

  models: [

    { id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image (Nano Banana 2)", params: [], kind: "image" },
    { id: "gemini-3-pro-image-preview", name: "Gemini 3 Pro Image (Nano Banana Pro)", params: [], kind: "image" },
    { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image (Nano Banana)", params: [], kind: "image" },

  ],
  serviceKinds: ["image","imageToText","webSearch"],

  imageConfig: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/models" },
  searchViaChat: {
    defaultModel: "gemini-2.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    pricingUrl: "https://ai.google.dev/pricing",
    freeTier: "Free tier: 15 RPM, 1M tokens/day on gemini-2.5-flash via AI Studio.",
  },
};
