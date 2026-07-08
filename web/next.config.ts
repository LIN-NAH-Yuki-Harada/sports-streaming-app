import type { NextConfig } from "next";

// Content-Security-Policy（まず Report-Only で導入し、実依存を観測してから強制へ）。
// 対象の外部依存（ブラウザ実行時）:
//   - script : Meta Pixel(connect.facebook.net) / hls.js(cdn.jsdelivr.net) / Vercel Analytics / Next インライン
//   - connect: Supabase(https+wss) / LiveKit(https+wss) / Vercel Insights / Meta Pixel
//   - img    : Google アバター(lh3) / Supabase / Meta Pixel ビーコン
//   - media  : LiveKit(blob) ほか
// Stripe.js はブラウザで読み込まない（Checkout はサーバー生成 URL へのリダイレクト）ため CSP 不要。
// ⚠️ 強制(enforce)前に必ず追加すること: 自前配信 HLS(MediaMTX/VPS) の再生オリジンを
//    connect-src と media-src に加える（現状は動的URLのため Report-Only の違反レポートで確定させる）。
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://cdn.jsdelivr.net https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.supabase.co https://www.facebook.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://*.vercel-insights.com https://www.facebook.com https://connect.facebook.net",
  "media-src 'self' blob: https://*.livekit.cloud",
  "frame-src 'self' https://www.facebook.com",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.11"],
  experimental: {
    optimizePackageImports: [
      "@supabase/ssr",
      "@supabase/supabase-js",
      "qrcode.react",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "**.supabase.co" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/lp", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
