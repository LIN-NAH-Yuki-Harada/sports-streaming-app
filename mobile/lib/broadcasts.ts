import { supabase } from "./supabase";

// broadcasts テーブル用のデータ層ヘルパー（React Native 専用・DOM/Node API 不使用）。
// Web 版（web/src/lib/database.ts）の挙動・カラム名と完全に一致させること。
// 視聴ページ live-spotch.com/watch/<share_code> のスコアボードへ Realtime で反映される。

// 配信レコードを新規作成（status=live で開始）。
// カラム名は Web の createBroadcast / App.tsx の insert と完全一致させる。
export async function createBroadcast(args: {
  broadcasterId: string;
  shareCode: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  tournament: string;
  teamId?: string | null;
  initialPeriod: string;
}): Promise<{ error?: string }> {
  const { error } = await supabase.from("broadcasts").insert({
    broadcaster_id: args.broadcasterId,
    share_code: args.shareCode,
    sport: args.sport,
    home_team: args.homeTeam,
    away_team: args.awayTeam,
    // 大会名は空なら null（Web 版に合わせる）
    tournament: args.tournament || null,
    team_id: args.teamId ?? null,
    period: args.initialPeriod,
    home_score: 0,
    away_score: 0,
    home_sets: 0,
    away_sets: 0,
    status: "live",
    // 発熱対策で焼き込みは既定 OFF（生配信・サーバー合成）
    scoreboard_burned_in: false,
  });

  if (error) return { error: error.message };
  return {};
}

// ライブ中のスコア / ピリオド更新。share_code で対象行を特定する。
// 渡された項目だけを UPDATE する（部分更新）。
export async function updateScore(
  shareCode: string,
  patch: Partial<{
    home_score: number;
    away_score: number;
    period: string;
    home_sets: number;
    away_sets: number;
    set_results: unknown;
    point_label: string | null;
  }>,
): Promise<void> {
  await supabase.from("broadcasts").update(patch).eq("share_code", shareCode);
}

// 配信終了（status=ended + 終了時刻を ISO-8601 で記録）。share_code で特定。
export async function endBroadcast(shareCode: string): Promise<void> {
  await supabase
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("share_code", shareCode);
}

// この配信者の「まだ live のまま残っている」配信を全て終了させる。
// Web の cleanupStaleBroadcasts の挙動を移植（broadcaster_id + status=live を ended に補正）。
// 異常終了で残ったゴースト配信が新規配信と二重化するのを防ぐ（新規開始前に呼ぶ想定）。
export async function sweepGhostBroadcasts(broadcasterId: string): Promise<void> {
  await supabase
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("broadcaster_id", broadcasterId)
    .eq("status", "live");
}
