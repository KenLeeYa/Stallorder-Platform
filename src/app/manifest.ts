import type { MetadataRoute } from "next";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getAppMessage } from "@/lib/app-messages";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { locale } = await getRequestAppLocale();

  return {
    id: "/",
    name: getAppMessage(locale, "app.name"),
    short_name: "StallOrder",
    description: getAppMessage(locale, "app.manifest.description"),
    start_url: "/launch",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#0f766e",
    orientation: "any",
    lang: locale,
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
