import { supabase } from "./supabase";
import { SITE_URL } from "../config";

// 視聴画面（WatchScreen）専用のデータ層（React Native 専用・DOM/Node API 不使用）。
// Web 版 web/src/app/watch/[code]/page.tsx と挙動・カラム名を一致させる。
// 視聴トークンは匿名可（Web の handleStartWatching と同じく Authorization ヘッダなし）。

// 視聴スコアボードに必要な公開列。Web 版 BROADCAST_PUBLIC_COLUMNS の許可列のうち
// 視聴表示に使うものだけを明示する（balls/strikes/outs/runners は #166 で列 GRANT 済み）。
const WATCH_COLUMNS =
  "id, share_code, broadcaster_id, sport, home_team, away_team, " +
  "home_score, away_score, home_sets, away_sets, tournament, period, point_label, " +
  "balls, strikes, outs, runners, status, started_at, scoreboard_burned_in, " +
  "live_youtube_broadcast_id";

export type WatchBroadcast = {
  id: string;
  share_code: string;
  broadcaster_id: string;
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
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  runners: { first?: boolean; second?: boolean; third?: boolean } | null;
  status: "live" | "ended";
  started_at: string;
  scoreboard_burned_in: boolean | null;
  live_youtube_broadcast_id: string | null;
};

// share_code から配信を1件取得する（同一コード再利用に備え started_at 降順で最新を採る）。
// Web の getBroadcastByCode 相当。見つからなければ null。
export async function getBroadcastByCode(
  shareCode: string,
): Promise<WatchBroadcast | null> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select(WATCH_COLUMNS)
    .eq("share_code", shareCode)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as WatchBroadcast;
}

// 視聴用 LiveKit トークンを取得する（role=viewer・匿名可なので Authorization なし）。
// 弱電波でも UI が固まらないよう 15 秒でタイムアウト。失敗時は null。
export async function fetchViewerToken(
  shareCode: string,
): Promise<string | null> {
  const viewerIdentity = `viewer-${Math.random().toString(36).slice(2, 9)}`;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${SITE_URL}/api/livekit/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: shareCode,
        participantIdentity: viewerIdentity,
        participantName: "視聴者",
        role: "viewer",
      }),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | { token?: string }
      | null;
    return json?.token ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
