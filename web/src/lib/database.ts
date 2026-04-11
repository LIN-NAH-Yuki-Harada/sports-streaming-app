import { createClient } from "./supabase";

// ===== 型定義 =====

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  plan: "free" | "broadcaster" | "team";
  created_at: string;
  updated_at: string;
};

export type Broadcast = {
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
  venue: string | null;
  period: string;
  status: "live" | "ended";
  started_at: string;
  ended_at: string | null;
};

// ===== プロフィール =====

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("プロフィール取得エラー:", error.message);
    return null;
  }
  return data;
}

export async function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile, "display_name">>
): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    console.error("プロフィール更新エラー:", error.message);
    return null;
  }
  return data;
}

// ===== 配信 =====

function generateShareCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createBroadcast(params: {
  userId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  tournament?: string;
  venue?: string;
  period: string;
}): Promise<Broadcast | null> {
  const supabase = createClient();

  // 共有コードの衝突時は最大3回リトライ
  for (let attempt = 0; attempt < 3; attempt++) {
    const shareCode = generateShareCode();
    const { data, error } = await supabase
      .from("broadcasts")
      .insert({
        broadcaster_id: params.userId,
        share_code: shareCode,
        sport: params.sport,
        home_team: params.homeTeam,
        away_team: params.awayTeam,
        tournament: params.tournament || null,
        venue: params.venue || null,
        period: params.period,
        home_score: 0,
        away_score: 0,
        status: "live",
      })
      .select()
      .single();

    if (!error) return data;

    // UNIQUE制約違反（コード衝突）ならリトライ
    if (error.code === "23505") {
      console.warn(`共有コード ${shareCode} が重複。リトライ ${attempt + 1}/3`);
      continue;
    }

    // それ以外のエラーは即終了
    console.error("配信作成エラー:", error.message);
    return null;
  }

  console.error("共有コード生成に3回失敗しました");
  return null;
}

export async function updateBroadcastScore(
  broadcastId: string,
  homeScore: number,
  awayScore: number,
  period: string,
  homeSets?: number,
  awaySets?: number
): Promise<boolean> {
  const supabase = createClient();
  const updates: Record<string, unknown> = {
    home_score: homeScore,
    away_score: awayScore,
    period: period,
  };
  if (homeSets !== undefined) updates.home_sets = homeSets;
  if (awaySets !== undefined) updates.away_sets = awaySets;

  const { error } = await supabase
    .from("broadcasts")
    .update(updates)
    .eq("id", broadcastId);

  if (error) {
    console.error("スコア更新エラー:", error.message);
    return false;
  }
  return true;
}

export async function endBroadcast(broadcastId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from("broadcasts")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
    })
    .eq("id", broadcastId);

  if (error) {
    console.error("配信終了エラー:", error.message);
    return false;
  }
  return true;
}

// 放置された配信を自動終了する（ページ読み込み時に呼ぶ）
// 開始から2時間以上経った live 配信のみ対象（配信中のものを誤終了しない）
export async function cleanupStaleBroadcasts(userId: string): Promise<void> {
  const supabase = createClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("broadcaster_id", userId)
    .eq("status", "live")
    .lt("started_at", twoHoursAgo);

  if (error) {
    console.error("古い配信のクリーンアップエラー:", error.message);
  }
}

// 配信されたチーム名一覧を取得（重複除去、自チーム=home_teamのみ）
export async function getTeamNames(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("home_team")
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("チーム名取得エラー:", error.message);
    return [];
  }

  // 重複を除去
  const unique = [...new Set(data.map((d) => d.home_team).filter(Boolean))];
  return unique;
}

export async function getBroadcastByCode(
  shareCode: string
): Promise<Broadcast | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("share_code", shareCode.toUpperCase())
    .single();

  if (error) {
    console.error("配信取得エラー:", error.message);
    return null;
  }
  return data;
}
