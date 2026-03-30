import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { RegisterSW } from "@/components/pwa/register-sw";
import "./globals.css";

const inter = Inter({
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
    default: "Pixwise",
    template: "%s | Pixwise",
  },
  description:
    "Split bills instantly. Scan your receipt, assign items, and settle via Pix in seconds.",
  keywords: ["pix", "split bill", "dividir conta", "nota fiscal", "NFC-e"],
  authors: [{ name: "Pixwise" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5fdfc" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1d2e" },
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
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__pwaInstallPrompt=null;window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__pwaInstallPrompt=e});`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
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
