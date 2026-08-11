import { AccessToken } from "livekit-server-sdk";
import { getAdminClient, getUser } from "@/lib/supabase-admin";
import {
  TRIAL_PROFILE_COLUMNS,
  type TrialProfile,
  isEnforceableFree,
  remainingSeconds,
  trialEnforceMode,
} from "@/lib/trial";

// 旧来の「配信単位で10分」判定。累積方式（lib/trial.ts）へ移行するまでの併存用。
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
      // broadcaster は必ず認証ユーザーと一致している必要がある
      const user = await getUser(request);
      if (!user) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (user.id !== participantIdentity) {
        return Response.json({ error: "Identity mismatch" }, { status: 403 });
      }

      const admin = getAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select(TRIAL_PROFILE_COLUMNS)
        .eq("id", user.id)
        .single();

      const p = (profile ?? null) as TrialProfile | null;
      const subscribed = p?.plan === "broadcaster" || p?.plan === "team";

      // (a) 既存の挙動（配信単位で10分）。ここは今日まで本番で動いているので温存する。
      //     ※ 配信単位なので「9分で切って開き直す」を繰り返せば実質無制限だった。
      if (!subscribed) {
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

      // (b) 累積方式（profiles.trial_seconds_used）への統一。cron/trial-enforce と
      //     完全に同じ判定（lib/trial.ts）を使い、上の「開き直し」の抜け道を塞ぐ。
      //     ロールアウトは cron と同じ TRIAL_ENFORCE_MODE の配下に置く
      //     ＝ on にするまで挙動は 1bit も変わらない。
      if (trialEnforceMode() === "on" && isEnforceableFree(p, Date.now())) {
        const remaining = remainingSeconds(p);
        if (remaining <= 0) {
          return Response.json({ error: "Trial time expired" }, { status: 403 });
        }
        // 累積の残り時間の方が短ければそちらに合わせる（最低60秒）
        ttl = `${Math.max(60, remaining)}s`;
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
