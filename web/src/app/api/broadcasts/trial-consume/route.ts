import { getAdminClient, getUser } from "@/lib/supabase-admin";

// 累積トライアル消費の上限（秒） = 10分
const TRIAL_MAX_SECONDS = 600;
// 1リクエストで加算できる上限（10分）— これを超える加算は不正とみなし、上限でクランプ
const PER_REQUEST_CAP = TRIAL_MAX_SECONDS;

// 配信終了時に消費した秒数を profiles.trial_seconds_used に加算する。
// body: { seconds: number } — 今回のセッションで実際に配信した秒数
// 加算は 600 秒を上限にクランプ。有料ユーザーには副作用なし。
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const rawSeconds = Number(body?.seconds);

    if (!Number.isFinite(rawSeconds) || rawSeconds < 0) {
      return Response.json({ error: "Invalid seconds" }, { status: 400 });
    }

    const addSeconds = Math.floor(Math.min(rawSeconds, PER_REQUEST_CAP));

    if (addSeconds === 0) {
      return Response.json({ success: true, trial_seconds_used: null });
    }

    const admin = getAdminClient();

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
