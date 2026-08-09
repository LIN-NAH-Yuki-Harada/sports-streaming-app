import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";
import { stopRtmpEgress } from "@/lib/livekit-rtmp-egress";
import { deleteEmptyLiveBroadcast } from "@/lib/youtube-live";
import { getOAuthClientForProfile } from "@/lib/youtube-upload";
import { getAdminClient, getUser } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// この秒数未満で終わった配信は「開始し直し」とみなし、YouTube 側の空枠を掃除する。
// ★これ単体では削除しない。deleteEmptyLiveBroadcast 側で「YouTube 的に一度も
//   live になっていない」ことも確認する二重判定（実際の試合を消さないため）。
const EMPTY_BROADCAST_MAX_SEC = 180;

/**
 * Live 中継停止 API（PR-3）
 *
 * 配信者が「配信終了」ボタンを押した時に呼ばれる想定。LiveKit Egress を
 * 停止し、broadcasts.live_status を 'ended' にマークする。
 *
 * 停止後の YouTube 側は createLiveBroadcast で enableAutoStop=true にしているため、
 * RTMP 切断検知後に YouTube が自動で broadcast を complete に遷移し、
 * その時点でアーカイブ動画（unlisted）がチャンネルに生成される。
 *
 * 万が一 enableAutoStop が動かない場合の救済として、live/start 側と同じく
 * transitionToComplete を呼ぶ余地はあるが、PR-3 では auto に任せる。
 * 必要なら別 PR でフォローアップ cron を追加。
 *
 * フラグ off / 既停止 / 未起動 のケースは 200 で noop。
 */
export async function POST(request: Request) {
  if (!isLiveArchiveEnabled()) {
    return Response.json({ skipped: "flag-off" });
  }

  const user = await getUser(request);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let broadcastId: string | undefined;
  try {
    const body = (await request.json()) as { broadcastId?: string };
    broadcastId = body.broadcastId;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!broadcastId) {
    return Response.json(
      { error: "broadcastId is required" },
      { status: 400 },
    );
  }

  const admin = getAdminClient();

  const { data: broadcast, error: bErr } = await admin
    .from("broadcasts")
    .select(
      "id, broadcaster_id, live_egress_id, live_status, live_youtube_broadcast_id, live_started_at, started_at",
    )
    .eq("id", broadcastId)
    .single();

  if (bErr || !broadcast) {
    return Response.json({ error: "Broadcast not found" }, { status: 404 });
  }
  if (broadcast.broadcaster_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!broadcast.live_egress_id) {
    return Response.json({ skipped: "not-started" });
  }
  if (broadcast.live_status === "ended" || broadcast.live_status === "failed") {
    return Response.json({ skipped: "already-ended", status: broadcast.live_status });
  }

  try {
    await stopRtmpEgress(broadcast.live_egress_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[live/stop] stopRtmpEgress failed:", message);
    // 停止失敗でも DB 上は ended 扱いにしないと UI が回復不能になる。
    // 実態としては LiveKit 側で残骸 egress が残るが webhook でいずれ拾える。
    await admin
      .from("broadcasts")
      .update({
        live_status: "failed",
        live_ended_at: new Date().toISOString(),
        live_error: message.slice(0, 500),
      })
      .eq("id", broadcast.id);
    return Response.json(
      { error: "Egress stop failed", message },
      { status: 500 },
    );
  }

  // egress_ended webhook 受信時に live_status='ended' + live_ended_at を確定する。
  // ここではベストエフォートで先回り更新（webhook 遅延時の UI 状態確保）。
  await admin
    .from("broadcasts")
    .update({
      live_status: "ended",
      live_ended_at: new Date().toISOString(),
    })
    .eq("id", broadcast.id);

  // ★空の配信枠を YouTube から掃除する（2026-08-10 追加）。
  //
  // 配信を開始した瞬間に YouTube 側の枠を作る設計のため、開始してすぐ止めて
  // 配信し直すと**中身の無い枠がチャンネルに残り続ける**。視聴者からは
  // 「サレジオ 0-0 AEGIS」のような空の配信が並んで見え、どちらを見ればよいか
  // 分からなくなる（2026-08-09 の関東大会で2試合とも発生）。
  //
  // ★実際の試合を消したら取り返しがつかないので、判定は**二重**にする:
  //   ここで「短時間で終わった」ことを確認し、さらに deleteEmptyLiveBroadcast 側で
  //   「YouTube 的に一度も live になっていない」ことを確認する。
  //   どちらか一方でも満たさなければ削除しない（fail-closed）。
  const cleanupTargetId = broadcast.live_youtube_broadcast_id;
  if (cleanupTargetId) {
    const startedIso = broadcast.live_started_at ?? broadcast.started_at;
    const startedMs = startedIso ? Date.parse(startedIso) : NaN;
    const elapsedSec = (Date.now() - startedMs) / 1000;
    // NaN の場合は比較が false になる＝削除しない（安全側）。
    const wasVeryShort = Number.isFinite(elapsedSec) && elapsedSec < EMPTY_BROADCAST_MAX_SEC;
    if (wasVeryShort) {
      try {
        const { data: prof } = await admin
          .from("profiles")
          .select("id, youtube_access_token, youtube_refresh_token")
          .eq("id", broadcast.broadcaster_id)
          .single();
        if (prof?.youtube_refresh_token) {
          const oauth = await getOAuthClientForProfile({
            id: prof.id,
            youtube_access_token: prof.youtube_access_token,
            youtube_refresh_token: prof.youtube_refresh_token,
          });
          await deleteEmptyLiveBroadcast(cleanupTargetId, oauth);
        }
      } catch (e) {
        // 掃除の失敗は配信停止の成否に影響させない（空枠が残るだけ）。
        console.error("[live/stop] 空枠の掃除に失敗（無害）:", e);
      }
    }
  }

  return Response.json({ stopped: true, egressId: broadcast.live_egress_id });
}
