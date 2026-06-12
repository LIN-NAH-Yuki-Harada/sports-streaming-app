import { supabase } from "./supabase";
import { fetchMyTeams, type MyTeam } from "./teams";

// 配信履歴タブ専用のデータ層（配信者ネイティブアプリ）。
// Web 版（web/src/lib/database.ts の getBroadcastHistory / getTeamBroadcastHistory、
// web/src/app/schedule/page.tsx の履歴表示）と同じテーブル/カラム/挙動に合わせる。
// RN 互換: DOM/Node API は使わず supabase-js のみで完結する。

// 視聴履歴カードに必要な broadcasts の列（Web の BROADCAST_PUBLIC_COLUMNS と同一）。
// set_results は GRANT 上 BROADCAST_PUBLIC_COLUMNS に含まれないため、ここでも選択しない。
// （Web 履歴ページも set_results を読むが select には載せておらず、無い前提で扱う）
const HISTORY_COLUMNS =
  "id, share_code, broadcaster_id, team_id, sport, home_team, away_team, " +
  "tournament, venue, home_score, away_score, home_sets, away_sets, period, point_label, " +
  "status, started_at, ended_at, scoreboard_burned_in, youtube_video_id, youtube_upload_status, " +
  "live_youtube_broadcast_id, live_status";

// 履歴カード 1 件分の表示型（Web の Broadcast から履歴で使う列だけ抜き出した最小型）。
export type HistoryBroadcast = {
  id: string;
  share_code: string;
  broadcaster_id: string;
  team_id: string | null;
  sport: string;
  home_team: string;
  away_team: string;
  tournament: string | null;
  home_score: number;
  away_score: number;
  home_sets: number;
  away_sets: number;
  // 各セットの最終得点（バレー等）。列GRANT未適用環境では空配列でフォールバック。
  set_results: { home: number; away: number }[];
  period: string;
  status: "live" | "ended";
  started_at: string;
  youtube_video_id: string | null;
  youtube_upload_status:
    | "pending"
    | "recording"
    | "uploading"
    | "completed"
    | "failed"
    | "cancelled"
    | null;
  live_youtube_broadcast_id: string | null;
  live_status: "pending" | "creating" | "live" | "ended" | "failed" | null;
};

// set_results は列レベル GRANT が別途必要（supabase-migration-broadcasts-set-results-grant.sql）。
// メインの履歴クエリに混ぜると未GRANT環境で 42501 になり履歴全体が壊れるため、
// 別クエリで取得し、失敗（未GRANT等）時は空配列のまま素通りさせる（セット別非表示）。
async function attachSetResults(
  rows: HistoryBroadcast[],
): Promise<HistoryBroadcast[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const { data, error } = await supabase
    .from("broadcasts")
    .select("id, set_results")
    .in("id", ids);
  if (error || !data) return rows; // 未GRANT/通信失敗時はセット別なしで返す
  const map = new Map<string, { home: number; away: number }[]>();
  for (const r of data as { id: string; set_results: unknown }[]) {
    map.set(r.id, Array.isArray(r.set_results) ? (r.set_results as { home: number; away: number }[]) : []);
  }
  return rows.map((r) => ({ ...r, set_results: map.get(r.id) ?? [] }));
}

// 自分が配信した「終了済み」配信を新しい順で取得。
// Web の getBroadcastHistory と同じ条件（broadcaster_id=自分 + status=ended + started_at DESC）。
// broadcasts は share_code 視聴のため SELECT が広く許可されているので broadcaster_id で必ず絞る。
export async function fetchMyHistory(
  userId: string,
  limit = 50,
): Promise<HistoryBroadcast[]> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select(HISTORY_COLUMNS)
    .eq("broadcaster_id", userId)
    .eq("status", "ended")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("配信履歴取得エラー:", error.message);
    return [];
  }
  const rows = (data ?? []).map((r) => ({
    ...(r as object),
    set_results: [],
  })) as unknown as HistoryBroadcast[];
  return attachSetResults(rows);
}

// 指定チームの「終了済み」配信を新しい順で取得。
// Web の getTeamBroadcastHistory（ライブ含む）を取得した上で履歴タブ同様 ended に絞る。
export async function fetchTeamHistory(
  teamId: string,
  limit = 100,
): Promise<HistoryBroadcast[]> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select(HISTORY_COLUMNS)
    .eq("team_id", teamId)
    .eq("status", "ended")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("チーム配信履歴取得エラー:", error.message);
    return [];
  }
  const rows = (data ?? []).map((r) => ({
    ...(r as object),
    set_results: [],
  })) as unknown as HistoryBroadcast[];
  return attachSetResults(rows);
}

// 履歴タブのフィルタチップ用に、自分の所属チームを取得（共有 lib/teams.ts を再利用）。
export async function fetchMyTeamsForHistory(userId: string): Promise<MyTeam[]> {
  return fetchMyTeams(userId);
}

// 競技ラベル → 絵文字（Web schedule/page.tsx の SPORT_EMOJI と一致）。
export const SPORT_EMOJI: Record<string, string> = {
  サッカー: "⚽",
  野球: "⚾",
  バスケ: "🏀",
  バレー: "🏐",
  陸上: "🏃",
  その他: "🏆",
};

export function sportEmoji(sport: string): string {
  return SPORT_EMOJI[sport] ?? "🏆";
}

// started_at を「6/12（木）」形式の日付グループキーに整形（Web 履歴と同一表記）。
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "日付不明"; // 不正な started_at でも落とさない
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

// started_at を「HH:MM」形式の時刻表示に整形。
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

// 連続する同日配信を日付ごとにまとめる（Web 履歴の grouped 構築と同じロジック）。
export type HistoryGroup = { date: string; items: HistoryBroadcast[] };
export function groupByDate(items: HistoryBroadcast[]): HistoryGroup[] {
  const grouped: HistoryGroup[] = [];
  for (const bc of items) {
    const date = dateGroupLabel(bc.started_at);
    const last = grouped[grouped.length - 1];
    if (last && last.date === date) last.items.push(bc);
    else grouped.push({ date, items: [bc] });
  }
  return grouped;
}

// この配信に YouTube 視聴リンクがあれば URL を返す（なければ null）。
// Web の表示優先度に合わせ、Live 中継アーカイブ（live_youtube_broadcast_id）を優先し、
// 無ければ旧パイプラインのアップロード済み動画（youtube_video_id）を使う。
// 視聴 URL は YouTube 標準形式（タスク指定: https://www.youtube.com/watch?v=ID）。
export function youtubeWatchUrl(bc: HistoryBroadcast): string | null {
  if (bc.live_status === "ended" && bc.live_youtube_broadcast_id) {
    return `https://www.youtube.com/watch?v=${bc.live_youtube_broadcast_id}`;
  }
  if (bc.youtube_upload_status === "completed" && bc.youtube_video_id) {
    return `https://www.youtube.com/watch?v=${bc.youtube_video_id}`;
  }
  return null;
}
