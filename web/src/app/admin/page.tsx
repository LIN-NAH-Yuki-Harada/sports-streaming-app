import Link from "next/link";
import { getAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// KPIカード（service_role で集計）。
export default async function AdminDashboard() {
  const admin = getAdminClient();

  const [liveRes, totalRes, usersRes, openReportsRes] = await Promise.all([
    admin.from("broadcasts").select("id", { count: "exact", head: true }).eq("status", "live"),
    admin.from("broadcasts").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const cards = [
    { label: "LIVE配信中", value: liveRes.count ?? 0 },
    { label: "累計配信", value: totalRes.count ?? 0 },
    { label: "会員数", value: usersRes.count ?? 0 },
    { label: "未対応の通報", value: openReportsRes.count ?? 0, alert: (openReportsRes.count ?? 0) > 0 },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">ダッシュボード</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border p-4 ${
              c.alert ? "border-[#e63946]/50 bg-[#e63946]/10" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="text-xs text-gray-400">{c.label}</div>
            <div className="text-3xl font-black tabular-nums mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      {(openReportsRes.count ?? 0) > 0 && (
        <Link
          href="/admin/reports"
          className="inline-block mt-4 text-sm text-[#e63946] hover:underline"
        >
          未対応の通報を確認する →
        </Link>
      )}

      <p className="text-xs text-gray-500 mt-8">
        ※ 配信/ユーザー/広告(CM)の管理画面は順次追加します（Phase 0/1）。
      </p>
    </div>
  );
}
