import { supabase } from "./supabase";

// ============================================================================
// UGCモデレーション（通報・ブロック）データ層。
// App Store Guideline 1.2 対応。reports / blocked_users テーブルを直接 supabase-js
// で操作する（RLS: 自分名義のみINSERT/管理可。web/supabase-migration-moderation.sql）。
// ============================================================================

// 通報理由（子ども安全配信の文脈に合わせた定型）。
export const REPORT_REASONS = [
  "不適切・わいせつな内容",
  "暴力・危険な行為",
  "嫌がらせ・いじめ",
  "個人情報・プライバシーの侵害",
  "その他",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * 配信/ユーザーを通報する（reporter_id は必ず自分）。
 * 成功で {ok:true}、失敗で {ok:false,error}。
 */
export async function submitReport(params: {
  reporterId: string;
  broadcastId?: string | null;
  reportedUserId?: string | null;
  shareCode?: string | null;
  reason: string;
  detail?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from("reports").insert({
      reporter_id: params.reporterId,
      reported_broadcast_id: params.broadcastId ?? null,
      reported_user_id: params.reportedUserId ?? null,
      share_code: params.shareCode ?? null,
      reason: params.reason,
      detail: params.detail ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch {
    return { ok: false, error: "通信エラーが発生しました。" };
  }
}

/** 自分がブロックしているユーザーIDの一覧を取得（表示フィルタ用）。失敗時は空配列。 */
export async function fetchBlockedIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", userId);
  if (error || !data) return [];
  return (data as { blocked_id: string }[]).map((r) => r.blocked_id);
}

/** 指定ユーザーをブロックする（重複はUNIQUE制約で握って成功扱い）。 */
export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (blockerId === blockedId) return { ok: false, error: "自分はブロックできません。" };
  try {
    const { error } = await supabase
      .from("blocked_users")
      .insert({ blocker_id: blockerId, blocked_id: blockedId });
    // 既にブロック済み（UNIQUE違反）は成功として扱う。
    if (error && !/duplicate|unique/i.test(error.message)) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "通信エラーが発生しました。" };
  }
}

/** ブロック解除。 */
export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId)
    .then(undefined, () => {});
}
