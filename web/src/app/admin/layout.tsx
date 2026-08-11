import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";

// 管理画面の共通レイアウト。全 /admin 配下をここでガードする（非管理者は notFound=404）。
// 常時サーバー評価（認可をビルド時にキャッシュさせない）。
export const dynamic = "force-dynamic";

const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "ダッシュボード" },
  { href: "/admin/growth", label: "成長" },
  { href: "/admin/reports", label: "通報対応" },
  { href: "/admin/broadcasts", label: "配信" },
  { href: "/admin/users", label: "ユーザー" },
  { href: "/admin/server", label: "サーバー" },
  { href: "/admin/ads", label: "広告(CM)" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage(); // 非管理者は 404

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/10 px-4 py-3 flex items-center gap-4 sticky top-0 bg-[#0a0a0a]/95 backdrop-blur z-10">
        <span className="font-black text-[#e63946]">LIVE SPOtCH 管理</span>
        <nav className="flex gap-1 overflow-x-auto text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="px-3 py-1.5 rounded-md text-gray-300 hover:bg-white/10 hover:text-white whitespace-nowrap transition"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      {/* ★ pb-24 は必須: BottomNav が `fixed bottom-0 z-50`（app/layout.tsx で
          MainContainer の外に描画）なので、余白が無いと**ページ末尾がナビの裏に隠れる**。
          2026-08-06 に「サーバー」タブの最後のグラフが切れて発覚。他ページも pb-20〜24 で
          同じ対処をしている（discover / broadcast / contact 等）。
          ★ <main> ではなく <div>: MainContainer が既に <main> を出しているため、
          ここで <main> を使うと入れ子になる（1ページに1つが正しい）。 */}
      <div className="p-4 md:p-6 pb-24 max-w-5xl mx-auto">{children}</div>
    </div>
  );
}
