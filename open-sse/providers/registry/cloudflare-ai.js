export default {
  id: "cloudflare-ai",
  priority: 60,
  hasFree: true,
  alias: "cloudflare-ai",
  aliases: [
    "cf",
  ],
  uiAlias: "cf",
  display: {
    name: "Cloudflare",
    icon: "cloud",
    color: "#F38020",
    textIcon: "CF",
    website: "https://developers.cloudflare.com/workers-ai/",
    notice: {
      text: "Workers AI free tier. Requires a Cloudflare API token and Account ID.",
      apiKeyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    },
  },
  category: "apikey",
  authType: "apikey",

  models: [

    { id: "@cf/black-forest-labs/flux-2-klein-9b", name: "FLUX.2 Klein 9B", params: ["size"], kind: "image" },
    { id: "@cf/black-forest-labs/flux-2-klein-4b", name: "FLUX.2 Klein 4B", params: ["size"], kind: "image" },
    { id: "@cf/black-forest-labs/flux-2-dev", name: "FLUX.2 Dev", params: ["size"], kind: "image" },
    { id: "@cf/leonardo/lucid-origin", name: "Lucid Origin", params: ["size"], kind: "image" },
    { id: "@cf/leonardo/phoenix-1.0", name: "Phoenix 1.0", params: ["size"], kind: "image" },
    { id: "@cf/black-forest-labs/flux-1-schnell", name: "FLUX.1 Schnell", params: ["size"], kind: "image" },
    { id: "@cf/bytedance/stable-diffusion-xl-lightning", name: "SDXL Lightning", params: ["size"], kind: "image" },
    { id: "@cf/lykon/dreamshaper-8-lcm", name: "DreamShaper 8 LCM", params: ["size"], kind: "image" },
    { id: "@cf/runwayml/stable-diffusion-v1-5-img2img", name: "Stable Diffusion v1.5 Img2Img", params: ["size"], capabilities: ["edit"], kind: "image" },
    { id: "@cf/runwayml/stable-diffusion-v1-5-inpainting", name: "Stable Diffusion v1.5 Inpainting", params: ["size"], capabilities: ["edit","mask"], kind: "image" },
    { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0", params: ["size"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://api.cloudflare.com/client/v4/accounts" },
};
