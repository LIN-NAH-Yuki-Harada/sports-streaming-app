import { getAdminClient } from "@/lib/supabase-admin";

// トライアル使用済みフラグを更新するエンドポイント
export async function POST(request: Request) {
  try {
    const { markTrialUsed, userId } = await request.json();

    if (!markTrialUsed || !userId) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const admin = getAdminClient();

    // userId が実在するか確認（なりすまし防止）
    const { data: profile } = await admin
      .from("profiles")
      .select("plan, trial_used")
      .eq("id", userId)
      .single();

    if (!profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    // 既にサブスク済みなら何もしない
    if (profile.plan === "broadcaster" || profile.plan === "team") {
      return Response.json({ success: true });
    }

    // trial_used を true に設定
    await admin
      .from("profiles")
      .update({ trial_used: true })
      .eq("id", userId);

    return Response.json({ success: true });
  } catch (e) {
    console.error("Trial mark error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
