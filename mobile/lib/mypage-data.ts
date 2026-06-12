import { supabase } from "./supabase";

// ============================================================================
// マイページ用のデータ取得ユーティリティ（配信専用ネイティブアプリ）。
//
// Web 版（live-spotch.com）と同じ Supabase バックエンド・同じテーブル/カラムを参照する。
// カラム名・取得列は Web のコードに完全準拠：
//   - profiles の機密列（youtube_*_token / stripe_*）は column-level GRANT で
//     クライアントから遮断されているため、web/src/lib/database.ts の getProfile と
//     同じ「明示列リスト」だけを SELECT する（それ以外を select すると 42501）。
//   - profiles.plan                 : "free" | "broadcaster" | "team"
//   - profiles.display_name         : 表示名（null 可）
//   - profiles.youtube_channel_id   : YouTube 連携済みなら非 null
//   - profiles.youtube_channel_name : 連携先チャンネル名（表示用）
//   - profiles.subscription_status  : Stripe サブスクの状態（表示用）
//
// 連携/解除・プラン変更の「実操作」はアプリ内に置かず Web へ誘導する方針
// （Apple IAP 回避のためアプリ内課金 UI は持たない）。ここは表示専用の取得のみ。
// ============================================================================

/** 配信プラン。profiles.plan の取り得る値（Web と同一）。 */
export type Plan = "free" | "broadcaster" | "team";

/**
 * マイページ表示用のプロフィール最小型。
 * Web の getProfile が返す列のうち、マイページで表示に使うものだけを持つ。
 */
export type MyProfile = {
  id: string;
  display_name: string | null;
  plan: Plan;
  // YouTube 連携（連携済みなら youtube_channel_id が非 null）
  youtube_channel_id: string | null;
  youtube_channel_name: string | null;
  youtube_live_enabled: boolean;
  // Stripe サブスク状態（"active" / "trialing" / "canceled" 等・表示用）
  subscription_status: string | null;
};

// クライアント（anon/authenticated）が SELECT できる列だけを明示指定する。
// web/src/lib/database.ts の getProfile と同一のリストに合わせる（機密列は含めない）。
const PROFILE_PUBLIC_COLUMNS =
  "id, display_name, plan, youtube_channel_id, youtube_channel_name, " +
  "youtube_live_enabled, subscription_status";

/**
 * 指定ユーザーのプロフィール（マイページ表示用）を取得する。
 * 取得失敗時は null を返す。plan が想定外の値なら安全側に "free" 扱い。
 */
export async function fetchMyProfile(userId: string): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_PUBLIC_COLUMNS)
    .eq("id", userId)
    .single();

  if (error || !data) {
    if (error) console.error("プロフィール取得エラー:", error.message);
    return null;
  }

  const row = data as unknown as {
    id: string;
    display_name: string | null;
    plan: Plan | null;
    youtube_channel_id: string | null;
    youtube_channel_name: string | null;
    youtube_live_enabled: boolean | null;
    subscription_status: string | null;
  };

  const plan: Plan =
    row.plan === "broadcaster" || row.plan === "team" ? row.plan : "free";

  return {
    id: row.id,
    display_name: row.display_name,
    plan,
    youtube_channel_id: row.youtube_channel_id,
    youtube_channel_name: row.youtube_channel_name,
    youtube_live_enabled: Boolean(row.youtube_live_enabled),
    subscription_status: row.subscription_status,
  };
}

/** プランの日本語表示ラベル（Web の PLAN_LABELS と一致させる）。 */
export const PLAN_LABELS: Record<Plan, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン（¥300/月）",
  team: "チームプラン（¥500/月）",
};
