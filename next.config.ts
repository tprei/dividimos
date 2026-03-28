import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
    serverComponentsHmrCache: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
