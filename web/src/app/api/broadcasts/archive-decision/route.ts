import { getAdminClient, getUser } from "@/lib/supabase-admin";

// 配信終了サマリで「YouTubeに保存しない」を選んだときに呼ばれる API。
// body: { broadcastId: string, decision: 'save' | 'discard' }
//   - 'save'    : 何もしない（webhook が pending をセット → cron がアップロード）
//   - 'discard' : youtube_upload_status='cancelled' に書き込む。後から webhook が
//                  完了通知してきても webhook 側で 'cancelled' を保護する。
//                  recording_key が既にあれば、cleanup cron が Storage の MP4 を削除する。
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const broadcastId =
      typeof body?.broadcastId === "string" && body.broadcastId.length > 0
        ? body.broadcastId
        : null;
    const decision = body?.decision;

    if (!broadcastId) {
      return Response.json(
        { error: "broadcastId is required" },
        { status: 400 },
      );
    }
    if (decision !== "save" && decision !== "discard") {
      return Response.json(
        { error: "decision must be 'save' or 'discard'" },
        { status: 400 },
      );
    }

    const admin = getAdminClient();

    // 所有権チェック
    const { data: broadcast } = await admin
      .from("broadcasts")
      .select("id, broadcaster_id, youtube_upload_status")
      .eq("id", broadcastId)
      .single();

    if (!broadcast) {
      return Response.json({ error: "Broadcast not found" }, { status: 404 });
    }
    if (broadcast.broadcaster_id !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // 'save' は no-op（既存フロー継続）
    if (decision === "save") {
      return Response.json({ success: true, decision });
    }

    // 'discard': cancelled に書き換える。
    // ただし既に completed/uploading の場合は手遅れなので変更しない。
    if (
      broadcast.youtube_upload_status === "completed" ||
      broadcast.youtube_upload_status === "uploading"
    ) {
      return Response.json({
        success: false,
        reason: "already_uploaded_or_uploading",
        currentStatus: broadcast.youtube_upload_status,
      });
    }

    const { error: uErr } = await admin
      .from("broadcasts")
      .update({ youtube_upload_status: "cancelled" })
      .eq("id", broadcastId);

    if (uErr) {
      console.error("[archive-decision] DB update failed:", uErr.message);
      return Response.json({ error: "Update failed" }, { status: 500 });
    }

    return Response.json({ success: true, decision });
  } catch (e) {
    console.error("[archive-decision] error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
