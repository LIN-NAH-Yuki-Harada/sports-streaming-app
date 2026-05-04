import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { ShareCodeInput, InstallGuide } from "@/components/home-extras";
import { HomeScheduleSection } from "@/components/home-schedule-section";
import { ScheduleItem } from "@/components/schedule-item";
import { getAdminClient } from "@/lib/supabase-admin";
import { getServerUser } from "@/lib/supabase-server";
import {
  BROADCAST_PUBLIC_COLUMNS,
  type Broadcast,
  type TeamSchedule,
} from "@/lib/database";

export const metadata: Metadata = {
  title: "ホーム",
  description:
    "LIVE SPOtCH のアプリホーム。共有コードでの視聴、あなたが配信した試合・所属チームの試合を一覧できます。",
  alternates: { canonical: "/discover" },
  robots: {
    index: false,
    follow: false,
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

type Membership = { team_id: string; role: "owner" | "admin" | "member" };

async function fetchMyMemberships(userId: string): Promise<Membership[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId);
  if (error || !data) return [];
  return data as Membership[];
}

async function fetchUpcomingSchedules(
  teamIds: string[],
  limit: number,
): Promise<TeamSchedule[]> {
  if (teamIds.length === 0) return [];
  const supabase = getAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("team_schedules")
    .select("*")
    .in("team_id", teamIds)
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return data as TeamSchedule[];
}

async function fetchMyTeams(
  teamIds: string[],
): Promise<{ id: string; name: string; sport: string }[]> {
  if (teamIds.length === 0) return [];
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, sport")
    .in("id", teamIds);
  if (error || !data) return [];
  return data as { id: string; name: string; sport: string }[];
}

// 配信 CTA を出すかの判定に使う。failure / 該当行なしは "free" 扱い。
async function fetchUserPlan(
  userId: string,
): Promise<"free" | "broadcaster" | "team"> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();
  const plan = data?.plan as string | undefined;
  if (plan === "broadcaster" || plan === "team") return plan;
  return "free";
}

/**
 * 自分が配信した + 所属チームの配信 を取得（status で絞り込み）。
 * 他人の配信は意図的に除外する（プライバシー保護）。
 */
async function fetchMyRelatedBroadcasts(
  userId: string,
  teamIds: string[],
  status: "live" | "ended",
  opts: { limit: number; since?: Date },
): Promise<Broadcast[]> {
  const supabase = getAdminClient();
  let query = supabase
    .from("broadcasts")
    .select(BROADCAST_PUBLIC_COLUMNS)
    .eq("status", status)
    .order("started_at", { ascending: false })
    .limit(opts.limit);
  if (opts.since) {
    query = query.gte("started_at", opts.since.toISOString());
  }
  // broadcaster_id = 自分 OR team_id in 所属チーム
  const orClauses: string[] = [`broadcaster_id.eq.${userId}`];
  if (teamIds.length > 0) {
    orClauses.push(`team_id.in.(${teamIds.join(",")})`);
  }
  query = query.or(orClauses.join(","));
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as unknown as Broadcast[];
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
  const user = await getServerUser();

  let live: Broadcast[] = [];
  let ended: Broadcast[] = [];
  let myTeams: { id: string; name: string; sport: string }[] = [];
  let userPlan: "free" | "broadcaster" | "team" = "free";
  let memberships: Membership[] = [];
  let upcoming: TeamSchedule[] = [];

  if (user) {
    memberships = await fetchMyMemberships(user.id);
    const teamIds = memberships.map((m) => m.team_id);
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    [live, ended, myTeams, userPlan, upcoming] = await Promise.all([
      fetchMyRelatedBroadcasts(user.id, teamIds, "live", { limit: 20 }),
      fetchMyRelatedBroadcasts(user.id, teamIds, "ended", { limit: 12, since }),
      fetchMyTeams(teamIds),
      fetchUserPlan(user.id),
      fetchUpcomingSchedules(teamIds, 20),
    ]);
  }

  // 配信可能プラン (broadcaster / team) のチームメンバーが予定 CRUD できる
  const isPaidUser = userPlan === "broadcaster" || userPlan === "team";
  const editableTeamIds = isPaidUser ? memberships.map((m) => m.team_id) : [];
  const editableTeams = myTeams.filter((t) => editableTeamIds.includes(t.id));
  const teamNameMap: Record<string, string> = Object.fromEntries(
    myTeams.map((t) => [t.id, t.name]),
  );

  // 予定セクションのバリアント決定
  // A: 配信可能プラン + チーム所属 → ホームから作成・編集
  // B: チーム所属あるが無料プラン → 読み取り専用で次の予定
  // C: どこにも所属していない → アップグレード CTA
  let scheduleVariant: "A" | "B" | "C" | null = null;
  if (user) {
    if (editableTeamIds.length > 0) scheduleVariant = "A";
    else if (memberships.length > 0) scheduleVariant = "B";
    else scheduleVariant = "C";
  }

  return (
    <div>
      {/* ヘッダー */}
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center justify-between">
          <Logo />
          {user && (
            <span className="text-xs text-gray-600">
              あなたの試合 {live.length} 件配信中
            </span>
          )}
        </div>
      </div>

      {/* 共有コード入力（常時表示） */}
      <ShareCodeInput />

      {/* ホーム画面追加ガイド（常時、PWA モードでは非表示） */}
      <InstallGuide />

      {/* 未ログイン時の誘導 */}
      {!user && (
        <section className="px-5 md:px-8 lg:px-10 pt-8 pb-24">
          <div className="rounded-xl bg-[#111] border border-white/5 p-5 md:p-6 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-[#e63946]/10 flex items-center justify-center mb-3">
              <svg
                className="w-5 h-5 text-[#e63946]"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-200">
              ログインしてあなたの試合を表示
            </p>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              LIVE SPOtCH は限定公開サービスです。
              <br />
              ログインすると、あなたが配信した試合や所属チームの試合のみが表示されます。
            </p>
            <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
              <Link
                href="/mypage"
                className="inline-block bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold px-6 py-2.5 rounded-md transition"
              >
                ログイン・新規登録
              </Link>
              <Link
                href="/"
                className="inline-block border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 text-sm font-semibold px-6 py-2.5 rounded-md transition"
              >
                サービス詳細
              </Link>
            </div>
            <p className="mt-4 text-[10px] text-gray-600 leading-relaxed">
              共有コードをお持ちの場合は、上のフォームにコードを入力して視聴できます（ログイン不要）
            </p>
          </div>
        </section>
      )}

      {/* ログイン時のみ: 自分に関係する配信 */}
      {user && (
        <>
          {/* LIVE 中（自分・所属チーム） */}
          <section className="px-5 md:px-8 lg:px-10 pt-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e63946] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#e63946]" />
              </span>
              <h1 className="text-base font-bold text-gray-200">
                あなたに関係する配信（LIVE中）
              </h1>
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
                  現在 LIVE 中の試合はありません
                </p>
                <p className="text-[11px] text-gray-700 mt-1">
                  あなた・所属チームの配信が始まるとここに表示されます
                </p>
              </div>
            )}
          </section>

          {/* 予定セクション（プラン × ロールでバリアント切替） */}
          {scheduleVariant === "A" && (
            <HomeScheduleSection
              initialSchedules={upcoming}
              editableTeams={editableTeams}
              teamNameMap={teamNameMap}
              editableTeamIds={editableTeamIds}
            />
          )}

          {scheduleVariant === "B" && (
            <section className="px-5 md:px-8 lg:px-10 pt-10">
              <h2 className="text-sm font-bold text-gray-300 mb-3">次の予定</h2>
              {upcoming.length > 0 ? (
                <>
                  <div className="grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {upcoming.slice(0, 5).map((s) => (
                      <ScheduleItem
                        key={s.id}
                        schedule={s}
                        teamName={teamNameMap[s.team_id] || ""}
                        canEdit={false}
                      />
                    ))}
                  </div>
                  {upcoming.length > 5 && (
                    <p className="mt-3 text-[10px] text-gray-600">
                      ほかに {upcoming.length - 5} 件の予定があります（チーム詳細から確認できます）
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-lg bg-[#111] border border-white/5 px-4 py-6 text-center">
                  <p className="text-xs text-gray-500">
                    所属チームに登録された予定はまだありません
                  </p>
                  <p className="text-[10px] text-gray-600 mt-1">
                    チームのオーナー・管理者が予定を追加するとここに表示されます
                  </p>
                </div>
              )}
            </section>
          )}

          {scheduleVariant === "C" && (
            <section className="px-5 md:px-8 lg:px-10 pt-10">
              <h2 className="text-sm font-bold text-gray-300 mb-3">次の予定</h2>
              {userPlan === "team" ? (
                <div className="rounded-xl bg-[#111] border border-white/5 p-5 text-center">
                  <p className="text-sm font-semibold mb-1">
                    チームを作成して予定を管理しましょう
                  </p>
                  <p className="text-[11px] text-gray-500 leading-relaxed max-w-md mx-auto">
                    チームを作成すると、試合の予定をチーム全体で共有できます。
                  </p>
                  <Link
                    href="/search"
                    className="inline-block mt-4 bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-5 py-2 rounded-md transition"
                  >
                    + チームを作成
                  </Link>
                </div>
              ) : (
                <div className="rounded-xl bg-gradient-to-br from-[#e63946]/10 via-[#111] to-[#111] border border-[#e63946]/20 p-5 text-center">
                  <p className="text-[10px] font-bold tracking-[0.2em] text-[#e63946] mb-1.5">
                    TEAM PLAN
                  </p>
                  <p className="text-sm font-semibold mb-1">
                    チームの予定をまとめて管理
                  </p>
                  <p className="text-[11px] text-gray-500 leading-relaxed max-w-md mx-auto">
                    チームプラン（¥500/月）で、試合の予定登録・チーム共有・YouTube Live 同時配信が使えます。
                  </p>
                  <Link
                    href="/pricing"
                    className="inline-block mt-4 bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-5 py-2 rounded-md transition"
                  >
                    プラン詳細を見る
                  </Link>
                </div>
              )}
            </section>
          )}

          {/* 直近終了した試合（自分・所属チーム） */}
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

          {/* 所属チーム */}
          {myTeams.length > 0 && (
            <section className="px-5 md:px-8 lg:px-10 pt-10 pb-12">
              <h2 className="text-sm font-bold text-gray-300 mb-3">
                あなたのチーム {myTeams.length} 件
              </h2>
              <div className="flex flex-wrap gap-2">
                {myTeams.map((team) => (
                  <Link
                    key={team.id}
                    href="/search"
                    className="text-xs text-gray-400 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-md transition"
                  >
                    {SPORT_EMOJI[team.sport] ?? "🏆"} {team.name}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* CTA: free → 配信開始勧誘 / broadcaster → team プラン昇格 / team → 非表示 */}
          {userPlan === "free" && (
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
                    href="/"
                    className="inline-block border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 text-sm font-semibold px-6 py-2.5 rounded-md transition"
                  >
                    サービス詳細
                  </Link>
                </div>
              </div>
            </section>
          )}

          {userPlan === "broadcaster" && (
            <section className="px-5 md:px-8 lg:px-10 pb-24">
              <div className="rounded-xl bg-gradient-to-br from-[#e63946]/15 via-[#111] to-[#111] border border-[#e63946]/30 p-6">
                <div className="text-center">
                  <p className="text-[10px] font-bold tracking-[0.2em] text-[#e63946] mb-1.5">
                    UPGRADE
                  </p>
                  <p className="text-base md:text-lg font-bold mb-1">
                    +¥200/月で、もっと使いやすく
                  </p>
                  <p className="text-xs text-gray-400 leading-relaxed max-w-md mx-auto">
                    チームプラン（¥500/月）にアップグレードすると、チーム運営機能と YouTube 連携が解放されます。
                  </p>
                </div>
                <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-gray-300 max-w-md mx-auto">
                  <li>✓ チーム作成・メンバー招待</li>
                  <li>✓ 試合スケジュール管理</li>
                  <li>✓ 共有コードのチーム自動配布</li>
                  <li className="text-gray-500">🔜 YouTube Live 同時配信</li>
                  <li className="text-gray-500">🔜 YouTube 自動アーカイブ</li>
                  <li className="text-gray-500">🔜 リモコンでスコア操作</li>
                  <li className="text-gray-500">🔜 AI ハイライト自動生成</li>
                </ul>
                <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
                  <Link
                    href="/pricing"
                    className="inline-block bg-[#e63946] hover:bg-[#d62836] text-white text-sm font-semibold px-6 py-2.5 rounded-md transition text-center"
                  >
                    チームプランに変更
                  </Link>
                  <Link
                    href="/pricing"
                    className="inline-block border border-white/15 text-gray-300 hover:text-white hover:bg-white/5 text-sm font-semibold px-6 py-2.5 rounded-md transition text-center"
                  >
                    詳細を見る
                  </Link>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
