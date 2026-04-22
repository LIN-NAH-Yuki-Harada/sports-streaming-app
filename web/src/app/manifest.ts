import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LIVE SPOtCH",
    short_name: "LIVE SPOtCH",
    description:
      "子どもの部活・スポーツ少年団・ローカル大会を、保護者がスマホで配信できるUGC型スポーツライブ配信アプリ。",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#e63946",
    orientation: "portrait",
    lang: "ja",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
