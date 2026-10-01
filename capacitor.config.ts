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
  webDir: "native-shell",

  server: {
    url: getDevServerUrl(),
    cleartext: devMode,
    allowNavigation: ["www.dividimos.ai"],
    ...(devMode ? {} : { errorPath: "offline.html" }),
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
    SystemBars: {
      initialViewportFitValueHint: "cover",
    },
    Keyboard: {
      // iOS resizes the WKWebView. Android ignores `resize`: SystemBars pads
      // the window by the IME inset under adjustResize. `resizeOnFullScreen`
      // stays unset; it subtracted the keyboard a second time.
      resize: KeyboardResize.Native,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SocialLogin: {
      providers: {
        google: true,
        apple: true,
        facebook: false,
        twitter: false,
      },
    },
  },
};

export default config;
