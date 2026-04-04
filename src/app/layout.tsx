import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { RegisterSW } from "@/components/pwa/register-sw";
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

export const metadata: Metadata = {
  title: {
    default: "Dividimos",
    template: "%s | Dividimos",
  },
  description:
    "Split bills instantly. Scan your receipt, assign items, and settle via Pix in seconds.",
  keywords: ["pix", "split bill", "dividir conta", "nota fiscal", "NFC-e"],
  authors: [{ name: "Dividimos" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
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
      className={`${nunito.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__pwaInstallPrompt=null;window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__pwaInstallPrompt=e});`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col safe-top safe-bottom">
        <RegisterSW />
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            className: "!bg-card !text-card-foreground !border !border-border !shadow-lg",
            duration: 3000,
          }}
        />
      </body>
    </html>
  );
}
