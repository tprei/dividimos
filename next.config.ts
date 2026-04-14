import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.0.2.2"],
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
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
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
