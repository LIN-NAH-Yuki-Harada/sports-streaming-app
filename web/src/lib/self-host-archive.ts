import type { getAdminClient } from "@/lib/supabase-admin";
import { buildSelfHostPlaybackUrl } from "@/lib/livekit-rtmp-egress";

/**
 * ブラウザ配信の録画を archive-worker に引き渡す印を付ける（2026-09-23）。
 *
 * ★なぜ専用の関数にしたか — **競合する2つの経路のどちらが勝っても効く**必要があるため
 *
 *   配信が終わるとき、次の2つが**競走**する:
 *     1. `live/stop`（配信者のブラウザが叩く）
 *     2. `egress-webhook`（LiveKit が Egress 終了を通知する）
 *   ブラウザ配信では配信者が抜けるとルームが空になり、Egress が**自力で終了**するため、
 *   2 が先に着くことが珍しくない。
 *
 *   `egress-webhook` には「終端 status は上書きしない」CAS ガードがあり、
 *   `live/stop` にも「既に ended なら何もしない」早期 return がある。
 *   つまり**負けた側は丸ごと何もしない**。ここに印付けをぶら下げると、
 *   どちらが負けるかで結果が変わり、**印が付かないことがある**。
 *   実際 2026-09-23 の実機テストで付かず、録画が孤児になった。
 *
 *   そこで印付けだけを切り出し、**CAS や早期 return の外側**で、
 *   `stream_playback_url IS NULL` を条件にした冪等な UPDATE にする。
 *   先に来たほうが書き、後から来たほうは 0 行更新で素通りする。
 *
 * ★なぜ配信終了時にしか書かないのか
 *   `stream_playback_url` は3つの役目を兼ねている:
 *     1. archive-worker の取得条件（`IS NOT NULL` かつ status='ended'）… **これだけが欲しい**
 *     2. 視聴ページの経路選択 … 配信中に立てると LiveKit(ほぼ実時間) →
 *        HLS(約11秒遅延) に**退行する**
 *     3. ghost sweep の対象条件（status='live' かつ非 null）… 自前 push が落ちただけで
 *        **試合中の配信を強制終了しかねない**
 *   終了時に書けば 1 だけを満たし、2 は `isLive` 条件付きなので参照されず、
 *   3 は status='live' が条件なので永久に一致しない。
 *
 * @returns 実際に印を付けたら true（既に付いていた・env 不足なら false）
 */
export async function markSelfHostArchiveOnEnd(
  admin: ReturnType<typeof getAdminClient>,
  broadcast: { id: string; share_code: string; stream_playback_url: string | null },
): Promise<boolean> {
  if (broadcast.stream_playback_url) return false;
  const playbackUrl = buildSelfHostPlaybackUrl(broadcast.share_code);
  if (!playbackUrl) return false;

  const { count, error } = await admin
    .from("broadcasts")
    .update({ stream_playback_url: playbackUrl }, { count: "exact" })
    .eq("id", broadcast.id)
    // ★競合しないための条件。もう片方が先に書いていたら 0 行で素通りする。
    .is("stream_playback_url", null);

  if (error) {
    console.error("[self-host-archive] 印付けに失敗:", error.message);
    return false;
  }
  if (count && count > 0) {
    console.info(
      `[self-host-archive] アーカイブ対象として登録: ${broadcast.share_code}`,
    );
    return true;
  }
  return false;
}
