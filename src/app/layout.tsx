import type { Metadata, Viewport } from "next";
import { Geist_Mono, Google_Sans, Nunito } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { MotionProvider } from "@/components/motion-provider";
import { NativeVersionGate } from "@/components/native-version-gate";
import { RegisterSW } from "@/components/pwa/register-sw";
import { ThemeSync } from "@/components/theme-sync";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Google's sign-in button rules require Google Sans. Without preload the file
// only downloads on pages that render that button. Next ships no fallback
// metrics for this family, so the fallback is explicit instead of size-adjusted.
const googleSans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
  weight: "500",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

const DESCRIPTION =
  "Tira foto da notinha, manda o link no grupo e cada um marca o que consumiu. O Pix sai com o valor certinho.";

export const metadata: Metadata = {
  metadataBase: new URL(`https://www.${BRAND.domain}`),
  title: {
    default: "Dividimos",
    template: "%s | Dividimos",
  },
  description: DESCRIPTION,
  keywords: ["pix", "dividir conta", "rachar conta"],
  authors: [{ name: "Dividimos" }],
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Dividimos",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9F9FB" },
    { media: "(prefers-color-scheme: dark)", color: "#09243f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${nunito.variable} ${geistMono.variable} ${googleSans.variable} h-dvh overflow-hidden antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__pwaInstallPrompt=null;window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__pwaInstallPrompt=e});`,
          }}
        />
      </head>
      {/* The body is the single safe-area owner and the only element sized to
          the measured visual viewport, so overlays and the shell agree on
          where the usable screen ends when the keyboard is up. */}
      <body className="fixed inset-x-0 top-[var(--app-viewport-top)] h-[var(--app-viewport-height)] w-full overflow-hidden flex flex-col safe-top safe-bottom">
        <ThemeSync />
        <RegisterSW />
        <MotionProvider>
          <NativeVersionGate>{children}</NativeVersionGate>
        </MotionProvider>
        {/* The toaster is fixed to the layout viewport, so the body's safe-top
            padding doesn't reach it; without the inset, toasts sit under the
            status bar and the Dynamic Island in the native apps. */}
        <Toaster
          position="top-center"
          containerStyle={{
            top: "calc(var(--app-viewport-top) + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 16px)",
          }}
          toastOptions={{
            className: "!bg-card !text-card-foreground !border !border-border !shadow-lg",
            duration: 3000,
          }}
        />
      </body>
    </html>
  );
}
