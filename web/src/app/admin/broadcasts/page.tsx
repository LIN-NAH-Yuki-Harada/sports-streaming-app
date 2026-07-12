import Link from "next/link";
import { getAdminClient } from "@/lib/supabase-admin";
import { ForceEndButton } from "./force-end-button";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  share_code: string | null;
  broadcaster_id: string | null;
  sport: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  period: string | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  live_status: string | null;
  live_youtube_broadcast_id: string | null;
  youtube_video_id: string | null;
  live_error: string | null;
};

// DBの時刻はUTC。サーバーレンダリング（Vercel=UTC）でも必ず日本時間で表示する
// （以前は生文字列のsliceでUTCのまま=9時間前に見えていた）。
function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\//g, "-");
}

// 経過分（live のゴースト検知用）。
function minutesSince(ts: string | null, nowMs: number): number | null {
  if (!ts) return null;
  return Math.floor((nowMs - new Date(ts).getTime()) / 60000);
}

export default async function AdminBroadcasts() {
  const admin = getAdminClient();
  const nowMs = Date.now();

  const { data } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, broadcaster_id, sport, home_team, away_team, home_score, away_score, period, status, started_at, ended_at, live_status, live_youtube_broadcast_id, youtube_video_id, live_error",
    )
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(60);
  const rows = (data ?? []) as Row[];

  // 配信者名をまとめて引く
  const ids = Array.from(
    new Set(rows.map((r) => r.broadcaster_id).filter(Boolean) as string[]),
  );
  const nameMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    for (const p of (profs ?? []) as { id: string; display_name: string | null }[]) {
      if (p.display_name) nameMap.set(p.id, p.display_name);
    }
  }

  const liveCount = rows.filter((r) => r.status === "live").length;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">配信</h1>
      <p className="text-xs text-gray-500 mb-4">
        直近60件。LIVE中が長時間（目安3時間〜）続いているものは異常終了の「ゴースト」の可能性。
        強制終了でLIVE状態を解消できます。 現在 LIVE: {liveCount}件
      </p>

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-gray-500">配信がありません。</p>
        )}
        {rows.map((r) => {
          const live = r.status === "live";
          const mins = live ? minutesSince(r.started_at, nowMs) : null;
          const ghostish = live && mins !== null && mins > 180;
          return (
            <div
              key={r.id}
              className={`rounded-lg border p-3 ${
                ghostish
                  ? "border-[#e63946]/60 bg-[#e63946]/10"
                  : live
                    ? "border-green-600/40 bg-green-600/[0.06]"
                    : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                    live ? "bg-green-600/30 text-green-300" : "bg-white/10 text-gray-400"
                  }`}
                >
                  {live ? "LIVE" : "終了"}
                </span>
                {r.sport && (
                  <span className="text-[10px] text-gray-500">{r.sport}</span>
                )}
                <span className="text-sm font-semibold">
                  {r.home_team ?? "—"}{" "}
                  <span className="tabular-nums text-gray-300">
                    {r.home_score ?? 0}-{r.away_score ?? 0}
                  </span>{" "}
                  {r.away_team ?? "—"}
                </span>
                {r.period && (
                  <span className="text-[10px] text-gray-500">({r.period})</span>
                )}
                {ghostish && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#e63946]/30 text-[#ffb3bb] font-semibold">
                    ゴースト疑い {mins}分
                  </span>
                )}
              </div>

              <div className="text-[11px] text-gray-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>
                  配信者:{" "}
                  {r.broadcaster_id
                    ? (nameMap.get(r.broadcaster_id) ?? r.broadcaster_id.slice(0, 8))
                    : "—"}
                </span>
                <span>開始: {fmt(r.started_at)}</span>
                {!live && <span>終了: {fmt(r.ended_at)}</span>}
                {r.live_status && <span>YouTube Live: {r.live_status}</span>}
                {r.share_code && (
                  <Link
                    href={`/watch/${r.share_code}`}
                    target="_blank"
                    className="text-[#e63946] hover:underline"
                  >
                    視聴ページ →
                  </Link>
                )}
                {(r.youtube_video_id || r.live_youtube_broadcast_id) && (
                  <a
                    href={`https://www.youtube.com/watch?v=${r.youtube_video_id ?? r.live_youtube_broadcast_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:underline"
                  >
                    YouTube →
                  </a>
                )}
              </div>

              {r.live_error && (
                <p className="text-[11px] text-[#ffb3bb] mt-1 break-all">
                  live_error: {r.live_error}
                </p>
              )}

              {live && (
                <div className="mt-2">
                  <ForceEndButton
                    id={r.id}
                    label={`${r.home_team ?? ""} vs ${r.away_team ?? ""}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
