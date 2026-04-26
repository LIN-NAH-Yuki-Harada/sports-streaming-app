import { getAdminClient, getUser } from "@/lib/supabase-admin";

// 累積トライアル消費の上限（秒） = 10分
const TRIAL_MAX_SECONDS = 600;
// 1リクエストで加算できる上限（10分）— これを超える加算は不正とみなし、上限でクランプ
const PER_REQUEST_CAP = TRIAL_MAX_SECONDS;

// 配信終了時に消費した秒数を profiles.trial_seconds_used に加算する。
// body: { seconds: number, broadcastId?: string }
//   - seconds: クライアントが計測した経過秒数
//   - broadcastId: 対象の broadcasts.id（省略時はサーバー検証なし＝PER_REQUEST_CAP のみで保護）
//
// 改ざん耐性: broadcastId が渡された場合、サーバー側で broadcasts.started_at から
// 実経過時間を算出し、クライアント報告と min を取る。これにより 0 秒や 1 秒で
// 600 秒消費した、といった不正報告を防ぐ。
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const rawSeconds = Number(body?.seconds);
    const broadcastId =
      typeof body?.broadcastId === "string" && body.broadcastId.length > 0
        ? body.broadcastId
        : null;

    if (!Number.isFinite(rawSeconds) || rawSeconds < 0) {
      return Response.json({ error: "Invalid seconds" }, { status: 400 });
    }

    const admin = getAdminClient();

    // サーバー側で実経過時間を算出してクライアント報告と比較する。
    // broadcastId が渡されていない場合（古いクライアント等）は PER_REQUEST_CAP のみで保護。
    let serverComputedElapsed: number = PER_REQUEST_CAP;
    if (broadcastId) {
      const { data: broadcast } = await admin
        .from("broadcasts")
        .select("started_at, broadcaster_id")
        .eq("id", broadcastId)
        .eq("broadcaster_id", user.id)
        .single();
      if (broadcast) {
        serverComputedElapsed = Math.max(
          0,
          Math.floor((Date.now() - new Date(broadcast.started_at).getTime()) / 1000)
        );
      }
    }

    // クライアント報告と server 計算の min を取り、PER_REQUEST_CAP でもクランプ。
    const addSeconds = Math.floor(
      Math.min(rawSeconds, serverComputedElapsed, PER_REQUEST_CAP)
    );

    if (addSeconds === 0) {
      return Response.json({ success: true, trial_seconds_used: null });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("plan, trial_seconds_used")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    // 有料ユーザーは消費不要
    if (profile.plan === "broadcaster" || profile.plan === "team") {
      return Response.json({
        success: true,
        trial_seconds_used: profile.trial_seconds_used ?? 0,
      });
    }

    const currentUsed = Number(profile.trial_seconds_used ?? 0);
    const nextUsed = Math.min(TRIAL_MAX_SECONDS, currentUsed + addSeconds);

    const { error } = await admin
      .from("profiles")
      .update({ trial_seconds_used: nextUsed })
      .eq("id", user.id);

    if (error) {
      console.error("Trial consume update error:", error);
      return Response.json({ error: "Update failed" }, { status: 500 });
    }

    return Response.json({ success: true, trial_seconds_used: nextUsed });
  } catch (e) {
    console.error("Trial consume error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
