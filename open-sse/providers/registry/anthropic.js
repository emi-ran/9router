export default {
  id: "anthropic",
  priority: 30,
  alias: "anthropic",
  display: {
    name: "Anthropic",
    icon: "smart_toy",
    color: "#D97757",
    textIcon: "AN",
    website: "https://console.anthropic.com",
    notice: {
      apiKeyUrl: "https://console.anthropic.com/settings/keys",
    },
  },
  category: "apikey",

  models: [

  ],
  serviceKinds: ["imageToText"],
};
