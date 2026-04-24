"use client";

import { usePathname } from "next/navigation";

const TEXT_PATHS = ["/terms", "/privacy", "/contact", "/reset-password"];
const WIDE_PREFIXES = ["/search", "/schedule"];

type Variant = "full" | "wide" | "normal" | "text";

function getVariant(pathname: string): Variant {
  if (pathname === "/") return "full"; // LP はフル幅
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
