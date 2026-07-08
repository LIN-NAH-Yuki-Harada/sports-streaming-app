import { timingSafeEqual } from "node:crypto";
import { isArchiveEnabled } from "@/lib/archive-flag";
import { isLiveArchiveEnabled } from "@/lib/live-archive-flag";
import { getEgressClient } from "@/lib/livekit-egress";
import { stopRtmpEgress } from "@/lib/livekit-rtmp-egress";
import { getAdminClient } from "@/lib/supabase-admin";
import { deleteRecording } from "@/lib/youtube-upload";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Vercel Cron の認証チェック（タイミング攻撃対策）
  const authHeader = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(authHeader);
  const authorized =
    !!process.env.CRON_SECRET &&
    expectedBuf.length === actualBuf.length &&
    timingSafeEqual(expectedBuf, actualBuf);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  // 心拍(last_seen_at)が STALE_MINUTES 途絶した live 配信はゴーストとみなす。
  // 配信者クライアントは配信中 60 秒ごとに last_seen_at を更新する（broadcast/page.tsx）。
  const STALE_MINUTES = 5;
  const staleThreshold = new Date(
    Date.now() - STALE_MINUTES * 60 * 1000,
  ).toISOString();

  // 1. ゴースト live 配信を自動終了する。
  //   (a) 心拍が STALE_MINUTES 途絶（last_seen_at < staleThreshold）＝配信者が落ちた/離脱した
  //   (b) 心拍が無い旧/他経路の配信（last_seen_at IS NULL）は従来どおり started_at > 2h で終了
  // ※ (a) により、心拍が続く限り長い試合は誤終了しない（旧「開始2時間で一律終了」の改善）。
  // ※ 検知の速さは cron 頻度に依存。日次のままでも安全に機能し、高頻度化(Vercel Pro)で数分検知になる。
  const { data, error } = await admin
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("status", "live")
    .or(
      `last_seen_at.lt.${staleThreshold},and(last_seen_at.is.null,started_at.lt.${twoHoursAgo})`,
    )
    .select("id");

  if (error) {
    console.error("Cron cleanup error:", error);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }

  // 2. 旧パイプライン: 暴走 Egress の強制停止（タブクローズで stop API すら飛ばなかったケースの巻き取り）
  // youtube_upload_status='recording' のまま 2 時間以上経過しているものは
  // クライアント側の停止処理が抜けた可能性が高いので強制停止する。
  let stuckStopped = 0;
  if (isArchiveEnabled()) {
    const { data: stuckBroadcasts } = await admin
      .from("broadcasts")
      .select("id, recording_egress_id")
      .eq("youtube_upload_status", "recording")
      .not("recording_egress_id", "is", null)
      .lt("started_at", twoHoursAgo)
      .limit(50);

    if (stuckBroadcasts && stuckBroadcasts.length > 0) {
      const client = getEgressClient();
      for (const bc of stuckBroadcasts) {
        if (!bc.recording_egress_id) continue;
        try {
          await client.stopEgress(bc.recording_egress_id);
          stuckStopped++;
        } catch (e) {
          // 既に LiveKit 側で終了済みのケース等。webhook が後で来れば DB 更新される。
          const msg = e instanceof Error ? e.message : "stop failed";
          console.warn(
            "[cron/cleanup] stuck egress stop failed:",
            bc.recording_egress_id,
            msg,
          );
        }
      }
    }
  }

  // 2-2. 新パイプライン (Live RTMP push) の暴走 Egress 強制停止 (5/10 追加)
  // live_status in (creating, live) で started_at > 2 時間経過のものを止める。
  // 旧パイプラインと別カラム (live_egress_id / live_status) を見るため独立ブロック。
  // クライアント側 live/stop が呼ばれずリーク → LiveKit Egress 課金過大を防ぐ。
  let liveStuckStopped = 0;
  if (isLiveArchiveEnabled()) {
    const { data: stuckLive } = await admin
      .from("broadcasts")
      .select("id, live_egress_id, live_youtube_broadcast_id")
      .in("live_status", ["creating", "live"])
      .not("live_egress_id", "is", null)
      .lt("started_at", twoHoursAgo)
      .limit(50);

    if (stuckLive && stuckLive.length > 0) {
      const stoppedIds: string[] = [];
      for (const bc of stuckLive) {
        if (!bc.live_egress_id) continue;
        try {
          await stopRtmpEgress(bc.live_egress_id);
          liveStuckStopped++;
          stoppedIds.push(bc.id);
        } catch (e) {
          // 既に LiveKit 側で終了済み or 不在のケース。webhook 経路で別途拾われる。
          const msg = e instanceof Error ? e.message : "stop failed";
          console.warn(
            "[cron/cleanup] stuck live egress stop failed:",
            bc.live_egress_id,
            msg,
          );
          // stopRtmpEgress に失敗しても DB の live_status は failed に揃える
          // （無限に creating / live のまま放置されないように）
          stoppedIds.push(bc.id);
        }
      }
      // DB の live_status を failed に揃える（webhook 遅延 or 失敗時のリカバリ）。
      // status カラムも ended にして UI から消す。
      if (stoppedIds.length > 0) {
        await admin
          .from("broadcasts")
          .update({
            live_status: "failed",
            live_ended_at: new Date().toISOString(),
            live_error: "auto-cleanup: stuck for over 2 hours",
            status: "ended",
            ended_at: new Date().toISOString(),
          })
          .in("id", stoppedIds);
      }
    }
  }

  // 3. アップロード中のまま 30 分以上経過した stale uploader を pending に戻す
  // (Sprint B のワーカーがクラッシュ / Vercel Function timeout 等で uploading
  //  のまま放置された row を自己回復させる。次の youtube-upload cron tick で
  //  通常通り再取得 → 再アップロードが走る)
  let staleUploadersReverted = 0;
  if (isArchiveEnabled()) {
    const thirtyMinutesAgo = new Date(
      Date.now() - 30 * 60 * 1000,
    ).toISOString();
    const { data: stale } = await admin
      .from("broadcasts")
      .update({
        youtube_upload_status: "pending",
      })
      .eq("youtube_upload_status", "uploading")
      .lt("youtube_upload_started_at", thirtyMinutesAgo)
      .select("id");
    staleUploadersReverted = stale?.length ?? 0;
    if (staleUploadersReverted > 0) {
      console.info(
        "[cron/cleanup] reverted stale uploaders to pending:",
        staleUploadersReverted,
      );
    }
  }

  // 4. 配信者が「YouTubeに保存しない」を選択した broadcast の MP4 を Storage から削除
  // (archive-decision API で youtube_upload_status='cancelled' に書き換えられたもの。
  //  webhook が後で recording_key をセットしてくる場合もあるため、ここでまとめて拾う)
  let cancelledMp4Removed = 0;
  if (isArchiveEnabled()) {
    const { data: cancelled } = await admin
      .from("broadcasts")
      .select("id, recording_key")
      .eq("youtube_upload_status", "cancelled")
      .not("recording_key", "is", null)
      .limit(50);

    if (cancelled && cancelled.length > 0) {
      for (const bc of cancelled) {
        if (!bc.recording_key) continue;
        try {
          await deleteRecording(bc.recording_key);
          await admin
            .from("broadcasts")
            .update({ recording_key: null, recording_file_path: null })
            .eq("id", bc.id);
          cancelledMp4Removed++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "delete failed";
          console.warn(
            `[cron/cleanup] cancelled MP4 delete failed for ${bc.id}:`,
            msg,
          );
        }
      }
    }
  }

  return Response.json({
    cleaned: data?.length || 0,
    stuckStopped,
    liveStuckStopped,
    staleUploadersReverted,
    cancelledMp4Removed,
  });
}
