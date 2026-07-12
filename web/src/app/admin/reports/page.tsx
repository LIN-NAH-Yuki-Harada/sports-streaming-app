import { getAdminClient } from "@/lib/supabase-admin";
import { ReportActions } from "./report-actions";

export const dynamic = "force-dynamic";

type Report = {
  id: string;
  reporter_id: string | null;
  reported_broadcast_id: string | null;
  reported_user_id: string | null;
  share_code: string | null;
  reason: string;
  detail: string | null;
  status: string;
  created_at: string;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com";

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

// 通報対応キュー（App Store Guideline 1.2 の「24時間以内対応」を運用する画面）。
// open を上に・経過24h超は赤バッジ。status を更新できる。
export default async function AdminReports() {
  const admin = getAdminClient();
  const { data } = await admin
    .from("reports")
    .select(
      "id, reporter_id, reported_broadcast_id, reported_user_id, share_code, reason, detail, status, created_at",
    )
    // open を最優先、その後 新しい順
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);

  const reports = (data ?? []) as Report[];
  const open = reports.filter((r) => r.status === "open");
  const others = reports.filter((r) => r.status !== "open");

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">通報対応</h1>
      <p className="text-xs text-gray-400 mb-4">
        未対応 {open.length} 件 / 全 {reports.length} 件。24時間以内の対応を目安に。
      </p>

      {reports.length === 0 ? (
        <p className="text-gray-400 text-sm">通報はありません。</p>
      ) : (
        <div className="space-y-2">
          {[...open, ...others].map((r) => {
            const aging = r.status === "open" && hoursSince(r.created_at) > 24;
            return (
              <div
                key={r.id}
                className={`rounded-lg border p-3 ${
                  r.status === "open"
                    ? aging
                      ? "border-[#e63946] bg-[#e63946]/10"
                      : "border-yellow-500/40 bg-yellow-500/[0.06]"
                    : "border-white/10 bg-white/[0.02] opacity-70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm">{r.reason}</span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(r.created_at).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}
                    {aging && <span className="ml-1 text-[#e63946] font-bold">⚠ 24h超</span>}
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-white/10">{r.status}</span>
                  </span>
                </div>
                {r.detail && <p className="text-xs text-gray-300 mt-1">{r.detail}</p>}
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                  {r.share_code && (
                    <a
                      href={`${SITE_URL}/watch/${r.share_code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#4ea3ff] hover:underline"
                    >
                      配信を見る（{r.share_code}）
                    </a>
                  )}
                  {r.reported_user_id && <span>対象user: {r.reported_user_id.slice(0, 8)}…</span>}
                </div>
                <ReportActions id={r.id} status={r.status} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
