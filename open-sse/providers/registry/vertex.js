export default {
  id: "vertex",
  priority: 40,
  alias: "vertex",
  aliases: [
    "vx",
  ],
  uiAlias: "vx",
  display: {
    name: "Vertex AI",
    icon: "cloud",
    color: "#4285F4",
    textIcon: "VX",
    website: "https://cloud.google.com/vertex-ai",
    notice: {
      text: "New Google Cloud accounts get $300 free credits. Requires GCP project + Service Account with Vertex AI API enabled.",
      apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    },
  },
  category: "apikey",

  models: [

  ],
  serviceKinds: ["imageToText"],
  // Veo via predictLongRunning + fetchPredictOperation (adapter: handlers/videoProviders/vertex.js).
  // Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation

};
