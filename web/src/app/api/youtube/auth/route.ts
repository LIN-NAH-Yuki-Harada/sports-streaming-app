import { google } from "googleapis";
import { getUser, getAdminClient } from "@/lib/supabase-admin";

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/youtube/callback`
);

export async function GET(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // チームプラン限定チェック
    const admin = getAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    if (profile?.plan !== "team") {
      return Response.json(
        { error: "YouTube連携はチームプランで利用できます" },
        { status: 403 }
      );
    }

    // Google OAuth 認証URL生成
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ],
      state: user.id, // コールバックでユーザーを特定
    });

    return Response.json({ authUrl });
  } catch (e) {
    console.error("YouTube auth error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
