import { supabase } from "./supabase";
import { SITE_URL } from "../config";

// ============================================================================
// チームタブ専用データヘルパー（配信専用ネイティブアプリ）。
// Web 版（live-spotch.com）と同じ Supabase バックエンド・Next.js API を叩く。
// テーブル/カラム/エンドポイントは Web のコードに完全準拠：
//   - GET  /api/teams        … 自分の所属チーム一覧（teams + team_members + profiles）
//   - POST /api/teams        … チーム作成（チームプラン限定・招待コード自動生成）
//   - POST /api/teams/join   … 招待コードで参加（team_members に role="member" 追加）
//   （web/src/app/api/teams/route.ts / api/teams/join/route.ts / search/page.tsx 準拠）
// VIEW（試合視聴）は当面 Web のまま：${SITE_URL}/watch/<share_code> を開く。
// ============================================================================

// ---- 型（Web の search/page.tsx の Team / TeamMember と同形）----

export type TeamRole = "owner" | "admin" | "member";

export type TeamMemberProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type TeamMember = {
  id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  profiles: TeamMemberProfile | null;
};

// 招待コードを含むフルのチーム型（マイチーム一覧 / 簡易詳細表示で使う）。
export type FullTeam = {
  id: string;
  name: string;
  sport: string;
  description: string | null;
  invite_code: string | null;
  owner_id: string;
  created_at: string;
  team_members: TeamMember[];
};

// 競技プルダウンの選択肢（Web の SPORT_EMOJI のキー + その他、絵文字付き）。
export const TEAM_SPORTS: { value: string; emoji: string }[] = [
  { value: "サッカー", emoji: "⚽" },
  { value: "野球", emoji: "⚾" },
  { value: "バスケ", emoji: "🏀" },
  { value: "バレー", emoji: "🏐" },
  { value: "陸上", emoji: "🏃" },
  { value: "テニス", emoji: "🎾" },
  { value: "卓球", emoji: "🏓" },
  { value: "水泳", emoji: "🏊" },
  { value: "ラグビー", emoji: "🏉" },
  { value: "ハンドボール", emoji: "🤾" },
  { value: "その他", emoji: "🏆" },
];

const SPORT_EMOJI_MAP: Record<string, string> = TEAM_SPORTS.reduce(
  (acc, s) => {
    acc[s.value] = s.emoji;
    return acc;
  },
  {} as Record<string, string>,
);

// 競技名から絵文字を引く（未知の競技はトロフィー）。
export function teamSportEmoji(sport: string): string {
  return SPORT_EMOJI_MAP[sport] || "🏆";
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

// 現在のセッションの access_token を取得（API 認証ヘッダ用）。
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * 自分の所属チーム一覧を取得する（招待コード + メンバー込み）。
 * Web と同じ GET /api/teams を叩く（service_role 経由で RLS を跨ぐため、
 * 招待コードやメンバー一覧まで取得できる）。
 */
export async function fetchMyFullTeams(): Promise<FullTeam[]> {
  const token = await getAccessToken();
  if (!token) return [];

  // 会場の弱電波が中心ユースケースのため、オフライン/DNS/TLS 失敗で fetch が throw しても
  // 未処理 reject にせず空配列で返す（createTeam/joinTeamByCode と同じ防御）。
  try {
    const res = await fetch(`${SITE_URL}/api/teams`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("チーム一覧取得エラー:", json?.error ?? res.status);
      return [];
    }
    return (json.teams ?? []) as FullTeam[];
  } catch (e) {
    console.error("チーム一覧取得の通信エラー:", e);
    return [];
  }
}

/**
 * チームを新規作成する（チームプラン限定）。
 * Web と同じ POST /api/teams（招待コード生成・owner として team_members 追加はサーバー側）。
 * 成功時は作成された team、失敗時は { error } を返す。
 */
export async function createTeam(params: {
  name: string;
  sport: string;
  description?: string;
}): Promise<{ team?: FullTeam; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { error: "セッションがありません。再ログインしてください。" };

  try {
    const res = await fetch(`${SITE_URL}/api/teams`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: params.name,
        sport: params.sport,
        description: params.description ?? "",
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json?.error ?? "チームの作成に失敗しました" };
    return { team: json.team as FullTeam };
  } catch {
    return { error: "通信エラーが発生しました。通信状況を確認してください。" };
  }
}

/**
 * 招待コードでチームに参加する。
 * Web と同じ POST /api/teams/join（自分=user_id のみ team_members に role="member" 追加）。
 * 既に参加済みなら alreadyMember=true で返る。
 */
export async function joinTeamByCode(
  inviteCode: string,
): Promise<{ team?: FullTeam; alreadyMember?: boolean; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { error: "セッションがありません。再ログインしてください。" };

  try {
    const res = await fetch(`${SITE_URL}/api/teams/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ inviteCode: inviteCode.trim().toUpperCase() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json?.error ?? "参加に失敗しました" };
    return { team: json.team as FullTeam, alreadyMember: !!json.alreadyMember };
  } catch {
    return { error: "通信エラーが発生しました。通信状況を確認してください。" };
  }
}
