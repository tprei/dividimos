import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

const devMode = process.env.CAPACITOR_DEV === "true";
const isIosSimulator = process.env.CAPACITOR_IOS_SIMULATOR === "true";

function getDevServerUrl(): string {
  if (!devMode) return "https://www.dividimos.ai";
  if (isIosSimulator) return "http://localhost:3000";
  return `http://${process.env.LAN_IP ?? "10.0.2.2"}:3000`;
}

const config: CapacitorConfig = {
  appId: "ai.dividimos.app",
  appName: "Dividimos",
  webDir: "out",

  server: {
    url: getDevServerUrl(),
    cleartext: devMode,
    allowNavigation: ["www.dividimos.ai"],
  },

  android: {
    allowMixedContent: false,
    backgroundColor: "#F9F9FB",
    buildOptions: {
      releaseType: "AAB",
    },
  },

  ios: {
    backgroundColor: "#F9F9FB",
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scheme: "Dividimos",
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#F9F9FB",
      androidSplashResourceName: "splash",
      iosSpinnerStyle: "small",
      showSpinner: false,
      launchFadeOutDuration: 300,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#F9F9FB",
    },
    Keyboard: {
      resize: KeyboardResize.None,
      resizeOnFullScreen: false,
    },
  },
};

export default config;
