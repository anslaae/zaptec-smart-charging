import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // HANDOFF §6f: "Smart lading" is exactly 12 characters, so it fits under the icon.
    name: "Smart lading",
    short_name: "Smart lading",
    description: "Planlegg lading av bilen på laderen hjemme",
    lang: "nb",
    start_url: "/",
    display: "standalone",
    background_color: "#0E0F0D",
    theme_color: "#0E0F0D",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Maskable (HANDOFF §1): the ring sits at 68 % so Android's crop never cuts it.
      // Separate entries from "any" -- never "any maskable" on one file.
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
