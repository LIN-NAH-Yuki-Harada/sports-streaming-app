import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { getAdminClient } from "@/lib/supabase-admin";
import type { Broadcast } from "@/lib/database";

export const metadata: Metadata = {
  title: "配信を探す",
  description:
    "LIVE SPOtCH でいま配信中の地域スポーツ・部活・スポーツ少年団の試合一覧。参加チームも随時更新。視聴は完全無料、共有コード不要でオープンな試合を観戦できます。",
  alternates: { canonical: "/discover" },
  openGraph: {
    title: "配信を探す | LIVE SPOtCH",
    description:
      "いま配信中の地域スポーツ・部活・スポーツ少年団の試合一覧。視聴は完全無料。",
    url: "/discover",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "配信を探す | LIVE SPOtCH",
    description:
      "いま配信中の地域スポーツ・部活・スポーツ少年団の試合一覧。視聴は完全無料。",
  },
};

// 配信状態はリアルタイム更新したいので SSR 毎回
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SPORT_EMOJI: Record<string, string> = {
  サッカー: "⚽",
  野球: "⚾",
  バスケ: "🏀",
  バレー: "🏐",
  陸上: "🏃",
  テニス: "🎾",
  卓球: "🏓",
  水泳: "🏊",
  ラグビー: "🏉",
  ハンドボール: "🤾",
};

async function fetchLive(): Promise<Broadcast[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("status", "live")
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return (data as Broadcast[]) ?? [];
}

async function fetchRecentlyEnded(): Promise<Broadcast[]> {
  const supabase = getAdminClient();
  const now = new Date();
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("status", "ended")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(12);
  if (error) return [];
  return (data as Broadcast[]) ?? [];
}

async function fetchTeams(): Promise<{ name: string; sport: string }[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("home_team, sport")
    .order("started_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  const seen = new Set<string>();
  const result: { name: string; sport: string }[] = [];
  for (const row of data) {
    const name = (row as { home_team?: string | null }).home_team;
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push({
        name,
        sport: (row as { sport?: string }).sport ?? "その他",
      });
    }
    if (result.length >= 40) break;
  }
  return result;
}

function aggregateSports(broadcasts: Broadcast[]): {
  sport: string;
  count: number;
}[] {
  const map = new Map<string, number>();
  for (const b of broadcasts) {
    map.set(b.sport, (map.get(b.sport) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([sport, count]) => ({ sport, count }))
    .sort((a, b) => b.count - a.count);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export default async function DiscoverPage() {
  const [live, ended, teams] = await Promise.all([
    fetchLive(),
    fetchRecentlyEnded(),
    fetchTeams(),
  ]);
  const sports = aggregateSports([...live, ...ended]);

  return (
    <div>
      {/* ヘッダー */}
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center justify-between">
          <Logo />
          <span className="text-xs text-gray-600">
            {live.length} 件配信中
          </span>
        </div>
      </div>

      {/* LIVE 中 */}
      <section className="px-5 md:px-8 lg:px-10 pt-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e63946] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#e63946]" />
          </span>
          <h1 className="text-base font-bold text-gray-200">いま配信中</h1>
        </div>

        {live.length > 0 ? (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {live.map((b) => (
              <Link
                key={b.id}
                href={`/watch/${b.share_code}`}
                className="rounded-lg bg-[#111] border border-white/5 hover:border-[#e63946]/40 transition p-4 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      <span className="mr-1.5">
                        {SPORT_EMOJI[b.sport] ?? "🏆"}
                      </span>
                      {b.home_team} vs {b.away_team}
                    </p>
                    {b.tournament && (
                      <p className="text-[11px] text-gray-500 truncate mt-0.5">
                        {b.tournament}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-gray-600">
                        {b.sport}
                      </span>
                      <span className="text-[10px] text-gray-600">
                        開始 {formatTime(b.started_at)}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 bg-[#e63946] text-white text-[9px] font-black px-1.5 py-0.5 rounded tracking-wider">
                    LIVE
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between pt-2 border-t border-white/5">
                  <span className="tabular-nums text-base font-black">
                    {b.home_score}{" "}
                    <span className="text-gray-600 text-sm">-</span>{" "}
                    {b.away_score}
                  </span>
                  <span className="text-[10px] text-[#e63946] group-hover:text-white transition">
                    視聴する →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-[#111] border border-white/5 px-4 py-8 text-center">
            <p className="text-sm text-gray-500">
              現在ライブ配信中の試合はありません
            </p>
            <p className="text-[11px] text-gray-700 mt-1">
              配信が始まるとここに表示されます
            </p>
          </div>
        )}
      </section>

      {/* 直近終了した試合 */}
      {ended.length > 0 && (
        <section className="px-5 md:px-8 lg:px-10 pt-10">
          <h2 className="text-sm font-bold text-gray-300 mb-3">
            直近終了した試合（48時間以内）
          </h2>
          <div className="grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {ended.map((b) => (
              <div
                key={b.id}
                className="rounded-md bg-[#0f0f0f] border border-white/5 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium truncate">
                    <span className="mr-1">
                      {SPORT_EMOJI[b.sport] ?? "🏆"}
                    </span>
                    {b.home_team} vs {b.away_team}
                  </p>
                  <span className="shrink-0 text-[9px] text-gray-600 font-bold">
                    終了
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-gray-600 tabular-nums">
                    {b.home_score} - {b.away_score}
                  </span>
                  <span className="text-[10px] text-gray-700">
                    {formatTime(b.started_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 対応スポーツ分布 */}
      {sports.length > 0 && (
        <section className="px-5 md:px-8 lg:px-10 pt-10">
          <h2 className="text-sm font-bold text-gray-300 mb-3">
            配信されたスポーツ
          </h2>
          <div className="flex flex-wrap gap-2">
            {sports.map((s) => (
              <span
                key={s.sport}
                className="text-xs text-gray-400 bg-white/5 px-3 py-1.5 rounded-md"
              >
                {SPORT_EMOJI[s.sport] ?? "🏆"} {s.sport}{" "}
                <span className="text-gray-600">({s.count})</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 参加チーム */}
      {teams.length > 0 && (
        <section className="px-5 md:px-8 lg:px-10 pt-10 pb-12">
          <h2 className="text-sm font-bold text-gray-300 mb-3">
            参加チーム {teams.length} 件
          </h2>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <span
                key={team.name}
                className="text-xs text-gray-500 bg-white/5 px-3 py-1.5 rounded-md"
              >
                {SPORT_EMOJI[team.sport] ?? "🏆"} {team.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="px-5 md:px-8 lg:px-10 pb-24">
        <div className="rounded-xl bg-gradient-to-br from-[#e63946]/20 via-[#111] to-[#111] border border-[#e63946]/30 p-6 text-center">
          <p className="text-base font-bold mb-1">
            あなたのチームも配信しませんか？
          </p>
          <p className="text-xs text-gray-400 leading-relaxed max-w-md mx-auto">
            保護者のスマホ1台で TV 中継品質のライブ配信。初回10分間は無料でお試しいただけます。
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
            <Link
              href="/broadcast"
              className="inline-block bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold px-6 py-2.5 rounded-md transition"
            >
              配信を始める
            </Link>
            <Link
              href="/lp"
              className="inline-block border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 text-sm font-semibold px-6 py-2.5 rounded-md transition"
            >
              サービス詳細
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
