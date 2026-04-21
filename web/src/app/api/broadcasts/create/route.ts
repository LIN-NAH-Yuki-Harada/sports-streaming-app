import { getAdminClient, getUser } from "@/lib/supabase-admin";

// トライアル使用済みフラグを更新するエンドポイント
export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { markTrialUsed } = await request.json().catch(() => ({}));
    if (!markTrialUsed) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: profile } = await admin
      .from("profiles")
      .select("plan, trial_used")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    // 既にサブスク済みなら何もしない
    if (profile.plan === "broadcaster" || profile.plan === "team") {
      return Response.json({ success: true });
    }

    await admin
      .from("profiles")
      .update({ trial_used: true })
      .eq("id", user.id);

    return Response.json({ success: true });
  } catch (e) {
    console.error("Trial mark error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
