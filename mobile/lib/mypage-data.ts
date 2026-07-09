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

/** profiles の行（明示列 SELECT の結果）を MyProfile に正規化する。 */
function mapProfileRow(data: unknown): MyProfile {
  const row = data as {
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

  return mapProfileRow(data);
}

/**
 * 表示名を更新する（Web 版 updateProfile の display_name 限定版）。
 * profiles は機密列が列レベル GRANT で遮断されているため、RETURNING * 相当の
 * .select()（引数なし）は 42501 になる。Web と同じく明示列リストで取得する。
 * 成功時は更新後のプロフィール、失敗時は null を返す。
 */
export async function updateDisplayName(
  userId: string,
  displayName: string,
): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId)
    .select(PROFILE_PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    if (error) console.error("表示名の更新エラー:", error.message);
    return null;
  }

  return mapProfileRow(data);
}

/** プランの日本語表示ラベル（Web の PLAN_LABELS と一致させる）。 */
export const PLAN_LABELS: Record<Plan, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン（¥300/月）",
  team: "チームプラン（¥500/月）",
};

// iOS 表示用の価格なしラベル（App Store Guideline 3.1.1: アプリ内でデジタル
// サブスクの価格表示＋外部Web決済への誘導はリジェクト要因になりうるため、
// iOS ビルドでは金額を出さない）。Android では PLAN_LABELS を使う。
export const PLAN_LABELS_NO_PRICE: Record<Plan, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン",
  team: "チームプラン",
};
