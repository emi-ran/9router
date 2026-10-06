import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "minimax",
  priority: 90,
  alias: "minimax",
  display: {
    name: "Minimax Coding",
    icon: "memory",
    color: "#7C3AED",
    textIcon: "MM",
    website: "https://www.minimaxi.com",
    notice: {
      apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    },
  },
  category: "apikey",

  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.

  models: [

    { id: "minimax-image-01", name: "MiniMax Image 01", params: ["n","size","response_format"], kind: "image" },

  ],
  serviceKinds: ["image","imageToText","webSearch"],

  imageConfig: { baseUrl: "https://api.minimaxi.com/v1/images/generations" },
  searchViaChat: {
    defaultModel: "MiniMax-M2.7",
    endpoint: "https://api.minimaxi.com/v1/text/chatcompletion_v2",
    pricingUrl: "https://www.minimaxi.com/document/price",
  },

};
