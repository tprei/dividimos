import type { NextConfig } from "next";
import path from "path";

function devServerHostname(url: string): string {
  if (!URL.canParse(url) || new URL(url).protocol !== "https:") {
    throw new Error(`DEV_SERVER_URL must be a full https:// URL, got "${url}".`);
  }
  return new URL(url).hostname;
}

const nextConfig: NextConfig = {
  // Next only serves hot reload to these hosts and localhost; without it a
  // WebView on another host reloads in a loop and never hydrates. The Android
  // emulator reaches the Mac at 10.0.2.2, a physical phone at the LAN_IP or
  // DEV_SERVER_URL that scripts/cap-dev.sh synced into the native config.
  allowedDevOrigins: [
    "10.0.2.2",
    ...(process.env.LAN_IP ? [process.env.LAN_IP] : []),
    ...(process.env.DEV_SERVER_URL ? [devServerHostname(process.env.DEV_SERVER_URL)] : []),
  ],
  // Surface Vercel's deployment ID to Next.js so old client bundles
  // (cached by service workers, Capacitor WebViews, PWAs) detect version
  // skew on their next navigation and hard-reload instead of calling
  // server actions whose closure IDs no longer exist on the new deploy.
  // Vercel sets VERCEL_DEPLOYMENT_ID automatically during the build.
  ...(process.env.VERCEL_DEPLOYMENT_ID
    ? { deploymentId: process.env.VERCEL_DEPLOYMENT_ID }
    : {}),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
    ],
    // Avatar URLs are Google OAuth photos stored once in users.avatar_url and
    // never rewritten, so an optimized /_next/image response can stay fresh far
    // longer than the 4-hour default. Next serves max-age of the larger of this
    // TTL and the upstream Cache-Control (node_modules/next/dist/docs, image.md).
    minimumCacheTTL: 2678400, // 31 days
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@supabase/supabase-js",
      "qrcode",
    ],
    serverComponentsHmrCache: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    const securityHeaders = [
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(self), geolocation=()",
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
    ];

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/claim",
        headers: [
          ...securityHeaders,
          {
            key: "Cache-Control",
            value: "private, no-store",
          },
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          ...securityHeaders,
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
