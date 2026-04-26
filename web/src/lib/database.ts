import { createClient } from "./supabase";

// ===== 型定義 =====

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  plan: "free" | "broadcaster" | "team";
  trial_used: boolean;
  trial_seconds_used: number;
  // YouTube 連携
  youtube_channel_id: string | null;
  youtube_channel_name: string | null;
  youtube_access_token: string | null;
  youtube_refresh_token: string | null;
  youtube_linked_at: string | null;
  // Stripe 連携（2026-04-14追加）
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
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
  set_results: { home: number; away: number }[];
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
  // 機密カラム（youtube_access_token / youtube_refresh_token /
  // stripe_customer_id / stripe_subscription_id）はクライアントから column-level
  // GRANT で遮断されているため、明示的なカラムリストで取得する。
  // これらの値が必要な処理は API ルート（service_role）経由で行う。
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, avatar_url, plan, trial_used, trial_seconds_used, " +
      "youtube_channel_id, youtube_channel_name, youtube_linked_at, " +
      "subscription_status, current_period_end, created_at, updated_at"
    )
    .eq("id", userId)
    .single();

  if (error) {
    console.error("プロフィール取得エラー:", error.message);
    return null;
  }
  // クライアント取得不可な機密カラムは null で埋めて Profile 型互換にする
  return {
    ...data,
    youtube_access_token: null,
    youtube_refresh_token: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
  } as Profile;
}

export async function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile, "display_name" | "avatar_url">>
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

// ===== チーム =====

export type Team = {
  id: string;
  name: string;
  sport: string;
  description: string | null;
  invite_code: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type TeamMember = {
  id: string;
  team_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  // JOIN で取得する場合
  profiles?: Pick<Profile, "id" | "display_name" | "avatar_url">;
};

export type TeamWithMembers = Team & {
  team_members: TeamMember[];
};

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createTeam(params: {
  userId: string;
  name: string;
  sport: string;
  description?: string;
}): Promise<Team | null> {
  const supabase = createClient();

  // 招待コードの衝突時は最大3回リトライ
  for (let attempt = 0; attempt < 3; attempt++) {
    const inviteCode = generateInviteCode();

    const { data: team, error } = await supabase
      .from("teams")
      .insert({
        name: params.name,
        sport: params.sport,
        description: params.description || null,
        invite_code: inviteCode,
        owner_id: params.userId,
      })
      .select()
      .single();

    if (!error) {
      // オーナーを team_members にも追加
      const { error: memberError } = await supabase
        .from("team_members")
        .insert({
          team_id: team.id,
          user_id: params.userId,
          role: "owner",
        });

      if (memberError) {
        console.error("オーナーメンバー追加エラー:", memberError.message);
      }

      return team;
    }

    // UNIQUE制約違反（招待コード衝突）ならリトライ
    if (error.code === "23505") {
      console.warn(`招待コード ${inviteCode} が重複。リトライ ${attempt + 1}/3`);
      continue;
    }

    console.error("チーム作成エラー:", error.message);
    return null;
  }

  console.error("招待コード生成に3回失敗しました");
  return null;
}

export async function getMyTeams(userId: string): Promise<TeamWithMembers[]> {
  const supabase = createClient();

  // 自分が所属するチームのIDを取得
  const { data: memberships, error: memError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);

  if (memError || !memberships?.length) return [];

  const teamIds = memberships.map((m) => m.team_id);

  const { data: teams, error } = await supabase
    .from("teams")
    .select("*, team_members(id, team_id, user_id, role, joined_at, profiles(id, display_name, avatar_url))")
    .in("id", teamIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("チーム一覧取得エラー:", error.message);
    return [];
  }
  return (teams as TeamWithMembers[]) || [];
}

export async function getTeamById(teamId: string): Promise<TeamWithMembers | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("*, team_members(id, team_id, user_id, role, joined_at, profiles(id, display_name, avatar_url))")
    .eq("id", teamId)
    .single();

  if (error) {
    console.error("チーム取得エラー:", error.message);
    return null;
  }
  return data as TeamWithMembers;
}

export async function updateTeam(
  teamId: string,
  updates: Partial<Pick<Team, "name" | "sport" | "description">>
): Promise<Team | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", teamId)
    .select()
    .single();

  if (error) {
    console.error("チーム更新エラー:", error.message);
    return null;
  }
  return data;
}

export async function deleteTeam(teamId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) {
    console.error("チーム削除エラー:", error.message);
    return false;
  }
  return true;
}

export async function joinTeamByInviteCode(
  userId: string,
  inviteCode: string
): Promise<{ team: Team; alreadyMember: boolean } | null> {
  const supabase = createClient();

  // 招待コードでチームを検索
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("invite_code", inviteCode.toUpperCase())
    .single();

  if (teamError || !team) {
    console.error("招待コードが見つかりません:", inviteCode);
    return null;
  }

  // 既にメンバーか確認
  const { data: existing } = await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", team.id)
    .eq("user_id", userId)
    .single();

  if (existing) {
    return { team, alreadyMember: true };
  }

  // メンバーとして参加
  const { error: joinError } = await supabase
    .from("team_members")
    .insert({
      team_id: team.id,
      user_id: userId,
      role: "member",
    });

  if (joinError) {
    console.error("チーム参加エラー:", joinError.message);
    return null;
  }

  return { team, alreadyMember: false };
}

export async function removeTeamMember(
  teamId: string,
  userId: string
): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) {
    console.error("メンバー削除エラー:", error.message);
    return false;
  }
  return true;
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: "admin" | "member"
): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from("team_members")
    .update({ role })
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) {
    console.error("ロール更新エラー:", error.message);
    return false;
  }
  return true;
}

// ===== 配信 =====

function generateShareCode(): string {
  // 8 文字 × 32 文字種 ≒ 40 bit エントロピー（旧 6 文字 30 bit からの強化）。
  // 推測攻撃と Birthday Paradox による衝突を実用上ほぼ無視できる範囲に下げる。
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
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
  teamId?: string;
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
        team_id: params.teamId || null,
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
  awaySets?: number,
  setResults?: { home: number; away: number }[]
): Promise<boolean> {
  const supabase = createClient();
  const updates: Record<string, unknown> = {
    home_score: homeScore,
    away_score: awayScore,
    period: period,
  };
  if (homeSets !== undefined) updates.home_sets = homeSets;
  if (awaySets !== undefined) updates.away_sets = awaySets;
  if (setResults !== undefined) updates.set_results = setResults;

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
export async function getTeamNames(): Promise<{ name: string; sport: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("home_team, sport")
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("チーム名取得エラー:", error.message);
    return [];
  }

  // チーム名で重複除去（最新の配信のスポーツを採用）
  const seen = new Set<string>();
  const result: { name: string; sport: string }[] = [];
  for (const d of data) {
    if (d.home_team && !seen.has(d.home_team)) {
      seen.add(d.home_team);
      result.push({ name: d.home_team, sport: d.sport });
    }
  }
  return result;
}

// 過去の配信履歴を取得（自分が配信したものに限る、終了済みのみ、新しい順）
export async function getBroadcastHistory(limit = 50): Promise<Broadcast[]> {
  const supabase = createClient();

  // broadcaster_id で必ず絞る。これがないと他ユーザーの終了済み配信が
  // 履歴タブに混入してしまう（broadcasts は share_code 視聴のため SELECT が広く許可されているテーブル）
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("broadcaster_id", userId)
    .eq("status", "ended")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("配信履歴取得エラー:", error.message);
    return [];
  }
  return data || [];
}

// チーム別の配信履歴を取得（ライブ含む、新しい順）
export async function getTeamBroadcastHistory(
  teamId: string,
  limit = 100
): Promise<Broadcast[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("team_id", teamId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("チーム配信履歴取得エラー:", error.message);
    return [];
  }
  return data || [];
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

// ===== チームスケジュール =====

export type TeamSchedule = {
  id: string;
  team_id: string;
  start_at: string;
  sport: string;
  home_team: string;
  away_team: string;
  location: string | null;
  tournament: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// 自分の所属チーム全体の予定を取得（RLS経由）
export async function listMyUpcomingSchedules(): Promise<TeamSchedule[]> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("team_schedules")
    .select("*")
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true });

  if (error) {
    console.error("予定取得エラー:", error.message);
    return [];
  }
  return data || [];
}

// 特定チームの予定を取得
export async function listTeamSchedules(
  teamId: string,
  scope: "upcoming" | "past" | "all" = "all"
): Promise<TeamSchedule[]> {
  const supabase = createClient();
  let query = supabase.from("team_schedules").select("*").eq("team_id", teamId);
  const nowIso = new Date().toISOString();
  if (scope === "upcoming") query = query.gte("start_at", nowIso);
  if (scope === "past") query = query.lt("start_at", nowIso);
  query = query.order("start_at", { ascending: scope !== "past" });

  const { data, error } = await query;
  if (error) {
    console.error("チーム予定取得エラー:", error.message);
    return [];
  }
  return data || [];
}
