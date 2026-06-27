import { supabase } from "./supabase";

// 配信専用ネイティブアプリ（配信者）用のチーム取得ロジック。
// Web と同じ Supabase バックエンド・同じテーブル/カラムを参照する。
// （web/src/app/discover/page.tsx の fetchMyMemberships / fetchMyTeams 準拠）
// RN 互換: DOM/Node API は使わず supabase-js のみで完結する。

// チームの最小表示型。配信開始時のチーム選択 UI で使う。
export type MyTeam = {
  id: string;
  name: string;
  sport: string;
};

/**
 * 自分が所属するチーム一覧を取得する。
 * 1) team_members.team_id（user_id で絞り込み）で所属チームの ID を集める
 * 2) teams テーブルから id, name, sport を取得する
 * Web の fetchMyMemberships → fetchMyTeams と同じ 2 段階クエリ。
 * カラム名は Web と完全一致（team_members.team_id / team_members.user_id /
 * teams.id, teams.name, teams.sport）。
 */
export async function fetchMyTeams(userId: string): Promise<MyTeam[]> {
  // 1) 所属メンバーシップから team_id を取得
  const { data: memberships, error: memError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);

  if (memError || !memberships?.length) {
    if (memError) console.error("所属チーム取得エラー:", memError.message);
    return [];
  }

  const teamIds = memberships.map((m) => m.team_id);

  // 2) teams から表示に必要な列だけ取得
  const { data: teams, error: teamError } = await supabase
    .from("teams")
    .select("id, name, sport")
    .in("id", teamIds);

  if (teamError || !teams) {
    if (teamError) console.error("チーム一覧取得エラー:", teamError.message);
    return [];
  }

  return teams as MyTeam[];
}
