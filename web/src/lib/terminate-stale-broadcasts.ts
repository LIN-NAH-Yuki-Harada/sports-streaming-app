import { getAdminClient } from "@/lib/supabase-admin";
import { deleteRoom } from "@/lib/livekit-egress";
import { stopRtmpEgress } from "@/lib/livekit-rtmp-egress";

/**
 * 指定ユーザーの「まだ生きている配信」をすべて強制終了する。
 *
 * 背景:
 * 配信が異常終了（起動失敗・画面を閉じる・端末スリープ）したとき、
 * クライアント側の停止処理が走らず、古い配信が裏で publish し続ける
 * （= ゴースト配信）。その状態で新しい配信を始めると、1 台の端末が映像を
 * 2 本同時にエンコードし、発熱して 15-20 分でシャットダウンする事故が起きる
 * （2026-06-07 サレジオ戦で実発生。同一 broadcaster が 02:00〜04:09 の
 * ゴースト ZCSVQLU4 と PY9H8DYZ を 18 分間同時配信していた）。
 *
 * 対策として「新規配信を開始する直前」にこれを呼び、同じ broadcaster の
 * 生きている配信を全部終了させる:
 *   1. LiveKit ルームを強制削除（裏のゴースト端末を切断 = エンコード負荷を止める）
 *   2. Egress（YouTube への RTMP push）を停止
 *   3. DB を ended に更新
 *
 * すべて best-effort（1 件失敗しても他を続行）。admin client で RLS を
 * バイパスし、別セッション由来のレコードも確実に終了できる。
 *
 * @returns 終了させた配信数
 */
export async function terminateStaleBroadcasts(userId: string): Promise<number> {
  const admin = getAdminClient();

  // 「生きている配信」= 自社プレイヤーが live（status='live'）か、
  // YouTube Live パイプラインが進行中（live_status in pending/creating/live）。
  // 前者が端末の二重エンコードの主因、後者は YouTube への迷子 push。
  const { data: stale, error } = await admin
    .from("broadcasts")
    .select("id, share_code, live_egress_id")
    .eq("broadcaster_id", userId)
    .or("status.eq.live,live_status.in.(pending,creating,live)");

  if (error) {
    console.error("[terminate-stale] select failed:", error.message);
    return 0;
  }
  if (!stale || stale.length === 0) return 0;

  const nowIso = new Date().toISOString();

  await Promise.allSettled(
    stale.map(async (bc) => {
      // 1. ゴースト端末を強制切断（最優先 = 端末のエンコード負荷を止める）
      if (bc.share_code) {
        await deleteRoom(bc.share_code).catch((e: unknown) =>
          console.warn(
            `[terminate-stale] deleteRoom ${bc.share_code} failed:`,
            e instanceof Error ? e.message : e,
          ),
        );
      }
      // 2. YouTube への RTMP push（Egress）を停止
      if (bc.live_egress_id) {
        await stopRtmpEgress(bc.live_egress_id).catch((e: unknown) =>
          console.warn(
            `[terminate-stale] stopEgress ${bc.live_egress_id} failed:`,
            e instanceof Error ? e.message : e,
          ),
        );
      }
      // 3. DB を終了に更新
      const { error: updErr } = await admin
        .from("broadcasts")
        .update({
          status: "ended",
          ended_at: nowIso,
          live_status: "ended",
          live_ended_at: nowIso,
        })
        .eq("id", bc.id);
      if (updErr) {
        console.error(`[terminate-stale] update ${bc.id} failed:`, updErr.message);
      }
    }),
  );

  return stale.length;
}
