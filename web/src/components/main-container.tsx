"use client";

import { usePathname } from "next/navigation";

const TEXT_PATHS = ["/terms", "/privacy", "/tokusho", "/account-deletion", "/contact", "/reset-password"];
const WIDE_PREFIXES = ["/search", "/schedule"];

type Variant = "full" | "wide" | "normal" | "text";

function getVariant(pathname: string): Variant {
  if (pathname === "/") return "full"; // LP はフル幅
  if (pathname.startsWith("/egress-template")) return "full"; // Egress 合成テンプレ（全画面・余白なし）
  // ★ 2026-08-04: 視聴ページは**動画が主役**なのに normal（PCで max-w-4xl）に落ちていて、
  //   大画面でも狭い列の中でしか映像が見られなかった。ページ側が自前で全画面レイアウトを
  //   組んでいる（min-h-screen / flex-col）ので full にする。
  if (pathname.startsWith("/watch")) return "full"; // 視聴ページ（映像を画面いっぱいに）
  // ★ 2026-08-06: 管理画面は自前で全画面レイアウト（min-h-screen / 独自ヘッダー /
  //   max-w-5xl）を組んでいるのに normal に落ちていて、**admin 側の max-w-5xl が
  //   MainContainer の max-w-4xl に締められて効いていなかった**。
  //   グラフを並べる画面なので幅は広いほうがよい。/watch と同じ理由で full にする。
  if (pathname.startsWith("/admin")) return "full"; // 管理画面（自前レイアウト・グラフ主体）
  if (TEXT_PATHS.some((p) => pathname.startsWith(p))) return "text";
  if (pathname === "/discover") return "wide";
  if (WIDE_PREFIXES.some((p) => pathname.startsWith(p))) return "wide";
  return "normal";
}

const WIDTH_CLASSES: Record<Exclude<Variant, "full">, string> = {
  wide: "max-w-[480px] md:max-w-3xl lg:max-w-5xl",
  normal: "max-w-[480px] md:max-w-2xl lg:max-w-4xl",
  text: "max-w-[480px] md:max-w-2xl lg:max-w-3xl",
};

export function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const variant = getVariant(pathname);

  if (variant === "full") {
    return (
      <main className="w-full min-h-screen bg-[#0a0a0a]">
        {children}
      </main>
    );
  }

  return (
    <main
      className={`mx-auto w-full ${WIDTH_CLASSES[variant]} min-h-screen bg-[#0a0a0a] relative md:shadow-[0_0_80px_rgba(230,57,70,0.05)] md:border-x md:border-white/5`}
    >
      {children}
    </main>
  );
}
