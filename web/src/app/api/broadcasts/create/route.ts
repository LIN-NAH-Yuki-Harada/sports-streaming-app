import { getUser, getAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sport, homeTeam, awayTeam, tournament, venue, period, teamId } = body;

    if (!sport || !homeTeam || !awayTeam || !period) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    // プロフィールを取得してプラン・トライアル状態をチェック
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("plan, trial_used")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    const subscribed = profile.plan === "broadcaster" || profile.plan === "team";

    // 無料ユーザーでトライアル済みの場合はブロック
    if (!subscribed && profile.trial_used) {
      return Response.json(
        { error: "Trial already used. Please subscribe to continue broadcasting." },
        { status: 403 }
      );
    }

    // 共有コード生成（衝突リトライ付き）
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 3; attempt++) {
      let shareCode = "";
      for (let i = 0; i < 6; i++) shareCode += chars[Math.floor(Math.random() * chars.length)];

      const { data: broadcast, error } = await admin
        .from("broadcasts")
        .insert({
          broadcaster_id: user.id,
          share_code: shareCode,
          sport,
          home_team: homeTeam,
          away_team: awayTeam,
          tournament: tournament || null,
          venue: venue || null,
          period,
          home_score: 0,
          away_score: 0,
          status: "live",
          team_id: teamId || null,
        })
        .select()
        .single();

      if (!error) {
        // 無料ユーザーの初回配信 → trial_used を true に設定
        if (!subscribed) {
          await admin
            .from("profiles")
            .update({ trial_used: true })
            .eq("id", user.id);
        }
        return Response.json({ broadcast });
      }

      // UNIQUE制約違反（コード衝突）ならリトライ
      if (error.code === "23505") continue;

      console.error("配信作成エラー:", error.message);
      return Response.json({ error: "Failed to create broadcast" }, { status: 500 });
    }

    return Response.json({ error: "Failed to generate share code" }, { status: 500 });
  } catch (e) {
    console.error("Broadcast creation error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
