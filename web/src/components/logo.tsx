import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/lp"
      aria-label="LIVE SPOtCH サービス紹介へ"
      className={`inline-flex items-center gap-2 hover:opacity-80 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e63946] rounded-sm ${className}`}
    >
      <span className="bg-[#e63946] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-wider">
        LIVE
      </span>
      <span className="text-base font-bold tracking-tight">LIVE SPOtCH</span>
    </Link>
  );
}
