import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "com.pixwise.app",
    name: "Pixwise — Divida a conta",
    short_name: "Pixwise",
    description:
      "Divida a conta do restaurante e liquide via Pix em segundos.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f5fdfc",
    theme_color: "#0d9488",
    orientation: "portrait",
    categories: ["finance", "utilities"],
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
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/narrow.png",
        sizes: "540x960",
        type: "image/png",
        form_factor: "narrow",
      },
    ],
    shortcuts: [
      {
        name: "Dividir conta",
        short_name: "Dividir",
        url: "/app",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Meus grupos",
        short_name: "Grupos",
        url: "/app/groups",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
