import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lading",
    short_name: "Lading",
    description: "Planlegg lading av bilen på Zaptec-laderen",
    lang: "nb",
    start_url: "/",
    display: "standalone",
    background_color: "#0E0F0D",
    theme_color: "#0E0F0D",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
