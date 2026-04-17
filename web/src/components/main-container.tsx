"use client";

import { usePathname } from "next/navigation";

const FULL_WIDTH_PATHS = ["/lp"];

export function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullWidth = FULL_WIDTH_PATHS.includes(pathname);

  if (isFullWidth) {
    return (
      <main className="w-full min-h-screen bg-[#0a0a0a]">
        {children}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[480px] min-h-screen bg-[#0a0a0a] relative md:shadow-[0_0_80px_rgba(230,57,70,0.05)] md:border-x md:border-white/5">
      {children}
    </main>
  );
}
