import { supabase } from "./supabase";

// ホームタブ専用のデータ層ヘルパー（React Native 専用・DOM/Node API 不使用）。
// Web 版 web/src/app/discover/page.tsx の fetchMyRelatedBroadcasts /
// fetchUpcomingSchedules と挙動・カラム名を完全一致させる。
// ※ lib/teams.ts / lib/broadcasts.ts などの共有ファイルは編集せず import のみ。

// broadcasts のクライアント取得可能な公開列のうち、ホーム LIVE カード表示に使う列。
// Web 版 BROADCAST_PUBLIC_COLUMNS（web/src/lib/database.ts）の許可列に含まれるものだけを
// 明示指定する（point_label もそこに含まれる＝列レベル GRANT で許可済み）。
const HOME_BROADCAST_COLUMNS =
  "id, share_code, broadcaster_id, team_id, sport, home_team, away_team, " +
  "home_score, away_score, home_sets, away_sets, tournament, period, point_label, " +
  "status, started_at";

// 競技名 → 絵文字（Web 版 discover/page.tsx の SPORT_EMOJI と一致）。
export const SPORT_EMOJI: Record<string, string> = {
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
  バドミントン: "🏸",
};

export function sportEmoji(sport: string): string {
  return SPORT_EMOJI[sport] ?? "🏆";
}

// ホームの LIVE カードに必要な配信の最小型（BROADCAST_PUBLIC_COLUMNS のサブセット）。
export type HomeBroadcast = {
  id: string;
  share_code: string;
  broadcaster_id: string;
  team_id: string | null;
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  home_sets: number;
  away_sets: number;
  tournament: string | null;
  period: string;
  point_label: string | null;
  status: "live" | "ended";
  started_at: string;
};

// チーム予定の最小型（web/src/lib/database.ts の TeamSchedule と同一カラム）。
export type HomeSchedule = {
  id: string;
  team_id: string;
  start_at: string;
  sport: string;
  home_team: string;
  away_team: string;
  location: string | null;
  tournament: string | null;
  notes: string | null;
};

/**
 * 自分に関係する LIVE 配信を取得する。
 * 条件: status="live" かつ (broadcaster_id = 自分 OR team_id IN 所属チーム)。
 * 他人の配信は意図的に除外（Web の fetchMyRelatedBroadcasts と同じ .or() 構成）。
 */
export async function fetchMyLiveBroadcasts(
  userId: string,
  teamIds: string[],
): Promise<HomeBroadcast[]> {
  let query = supabase
    .from("broadcasts")
    .select(HOME_BROADCAST_COLUMNS)
    .eq("status", "live")
    .order("started_at", { ascending: false })
    .limit(20);

  // broadcaster_id = 自分 OR team_id in 所属チーム（Web 版と同じ OR 句）
  const orClauses: string[] = [`broadcaster_id.eq.${userId}`];
  if (teamIds.length > 0) {
    orClauses.push(`team_id.in.(${teamIds.join(",")})`);
  }
  query = query.or(orClauses.join(","));

  const { data, error } = await query;
  if (error) {
    console.error("LIVE配信取得エラー:", error.message);
    return [];
  }
  return (data ?? []) as unknown as HomeBroadcast[];
}

/**
 * 所属チームの今後の予定を取得する（v1 は閲覧のみ）。
 * Web 版 fetchUpcomingSchedules と同じく start_at >= now を昇順で。
 */
export async function fetchUpcomingSchedules(
  teamIds: string[],
  limit = 20,
): Promise<HomeSchedule[]> {
  if (teamIds.length === 0) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("team_schedules")
    .select("id, team_id, start_at, sport, home_team, away_team, location, tournament, notes")
    .in("team_id", teamIds)
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("予定取得エラー:", error.message);
    return [];
  }
  return (data ?? []) as unknown as HomeSchedule[];
}
