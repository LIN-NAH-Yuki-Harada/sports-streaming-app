import { AccessToken } from "livekit-server-sdk";
import { getAdminClient } from "@/lib/supabase-admin";

const TRIAL_DURATION_MS = 10 * 60 * 1000; // 10分

export async function POST(request: Request) {
  try {
    const { roomName, participantIdentity, participantName, role } =
      await request.json();

    if (!roomName || !participantIdentity) {
      return Response.json(
        { error: "roomName and participantIdentity are required" },
        { status: 400 }
      );
    }

    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return Response.json(
        { error: "LiveKit credentials not configured" },
        { status: 500 }
      );
    }

    // 配信者のトークン発行時に、無料ユーザーの10分制限をチェック
    let ttl = role === "broadcaster" ? "8h" : "6h";
    if (role === "broadcaster") {
      const admin = getAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("plan")
        .eq("id", participantIdentity)
        .single();

      const subscribed = profile?.plan === "broadcaster" || profile?.plan === "team";

      if (!subscribed) {
        // 無料ユーザー: この配信が10分を超えていないかチェック
        const { data: broadcast } = await admin
          .from("broadcasts")
          .select("started_at")
          .eq("share_code", roomName)
          .single();

        if (broadcast) {
          const elapsed = Date.now() - new Date(broadcast.started_at).getTime();
          if (elapsed >= TRIAL_DURATION_MS) {
            return Response.json(
              { error: "Trial time expired" },
              { status: 403 }
            );
          }
          // 残り時間だけのTTLを発行
          const remainingMs = TRIAL_DURATION_MS - elapsed;
          const remainingSec = Math.max(60, Math.ceil(remainingMs / 1000));
          ttl = `${remainingSec}s`;
        }
      }
    }

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: participantIdentity,
        name: participantName || participantIdentity,
        ttl,
      }
    );

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: role === "broadcaster",
      canSubscribe: true,
    });

    const jwt = await token.toJwt();

    return Response.json({ token: jwt });
  } catch (e) {
    console.error("Token generation error:", e);
    return Response.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
}
