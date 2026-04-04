import type { CapacitorConfig } from "@capacitor/cli";

const devMode = process.env.CAPACITOR_DEV === "true";

const config: CapacitorConfig = {
  appId: "ai.dividimos.app",
  appName: "Dividimos",
  webDir: "out",

  server: {
    url: devMode ? `http://${process.env.LAN_IP ?? "10.0.2.2"}:3000/app` : "https://dividimos.ai/app",
    cleartext: devMode,
  },

  android: {
    allowMixedContent: false,
    backgroundColor: "#F9F9FB",
    buildOptions: {
      releaseType: "AAB",
    },
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#F9F9FB",
      androidSplashResourceName: "splash",
      showSpinner: false,
      launchFadeOutDuration: 300,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#F9F9FB",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
