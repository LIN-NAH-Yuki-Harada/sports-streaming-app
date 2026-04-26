import { timingSafeEqual } from "node:crypto";
import { isArchiveEnabled } from "@/lib/archive-flag";
import { getEgressClient } from "@/lib/livekit-egress";
import { getAdminClient } from "@/lib/supabase-admin";

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

  // 1. 2時間以上経った live 配信を自動終了
  const { data, error } = await admin
    .from("broadcasts")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("status", "live")
    .lt("started_at", twoHoursAgo)
    .select("id");

  if (error) {
    console.error("Cron cleanup error:", error);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }

  // 2. 暴走 Egress の強制停止（タブクローズで stop API すら飛ばなかったケースの巻き取り）
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

  return Response.json({ cleaned: data?.length || 0, stuckStopped });
}
