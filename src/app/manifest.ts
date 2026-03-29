import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pixwise — Divida a conta",
    short_name: "Pixwise",
    description:
      "Divida a conta do restaurante e liquide via Pix em segundos.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f5fdfc",
    theme_color: "#0d9488",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
