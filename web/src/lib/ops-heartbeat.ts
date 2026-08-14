import { getAdminClient } from "@/lib/supabase-admin";

/**
 * cron の生存記録（ops_heartbeat）
 *
 * 「サイトは開くのに cron だけ黙っている」を検知するための心拍。
 * 各 cron が認証を通った直後にこれを呼ぶ。VPS のウォッチドッグが
 * /api/health 経由で最新値の鮮度を見て発報する。
 *
 * ★この関数は絶対に throw しない。
 *   心拍の記録に失敗しても本処理（配信の掃除・アーカイブ・課金判定）は
 *   止めてはならない。過去に cron の型エラーで全ユーザーが無料化した前科がある。
 *
 * ★意図的に await して使う。
 *   「本処理をブロックしない」ために fire-and-forget にすると、サーバーレスでは
 *   レスポンス返却後に関数が凍結されて upsert が届かないことがある。
 *   心拍が届かない = 「cron が死んだ」という誤報になり、監視として最悪の壊れ方をする。
 *   そのため確実に届く await 方式を採り、代わりに 3 秒のハードタイムアウトで
 *   「詰まって本処理を止める」リスクを断つ。cron は誰も待っていないので
 *   数十ミリ秒の遅延は無害。
 */
const HEARTBEAT_TIMEOUT_MS = 3000;

export type HeartbeatName =
  | "cron:cleanup"
  | "cron:youtube-upload"
  | "cron:alerts"
  | "cron:no-video"
  | "cron:trial-enforce"
  | "cron:daily-health";

export async function recordHeartbeat(
  name: HeartbeatName,
  opts?: { ok?: boolean; detail?: string | null },
): Promise<void> {
  try {
    const admin = getAdminClient();
    const { error } = await admin
      .from("ops_heartbeat")
      .upsert(
        {
          name,
          last_run_at: new Date().toISOString(),
          ok: opts?.ok ?? true,
          // 秘密情報は入れない。診断用の短いメモだけ。
          detail: opts?.detail ? opts.detail.slice(0, 300) : null,
        },
        { onConflict: "name" },
      )
      .abortSignal(AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS));
    if (error) {
      // テーブル未作成（マイグレーション未適用）もここに来る。警告だけ出して続行。
      console.warn(`[heartbeat] ${name} upsert failed (ignored):`, error.message);
    }
  } catch (e) {
    console.warn(`[heartbeat] ${name} failed (ignored):`, String(e).slice(0, 200));
  }
}
