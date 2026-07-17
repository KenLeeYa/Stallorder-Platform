import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "StallOrder 攤點通",
    short_name: "StallOrder",
    description: "攤位 QR 點餐、店員接單與營運管理",
    start_url: "/login?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#0f766e",
    orientation: "any",
    lang: "zh-Hant-TW",
    categories: ["business", "food"],
    icons: [
      {
        src: "/icons/stallorder-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/stallorder-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
