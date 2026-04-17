import { google } from "googleapis";
import { getAdminClient } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/youtube/callback`
);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // ユーザーが認証を拒否した場合
    if (error || !code || !userId) {
      return NextResponse.redirect(
        new URL("/mypage?youtube=cancelled", request.url)
      );
    }

    // 認証コードをトークンに交換
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // YouTube APIでチャンネル情報を取得
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const channelRes = await youtube.channels.list({
      part: ["snippet"],
      mine: true,
    });

    const channel = channelRes.data.items?.[0];
    const channelId = channel?.id || null;
    const channelName = channel?.snippet?.title || null;

    // profiles テーブルにYouTube情報を保存
    const admin = getAdminClient();
    await admin
      .from("profiles")
      .update({
        youtube_channel_id: channelId,
        youtube_channel_name: channelName,
        youtube_access_token: tokens.access_token,
        youtube_refresh_token: tokens.refresh_token,
        youtube_linked_at: new Date().toISOString(),
      })
      .eq("id", userId);

    return NextResponse.redirect(
      new URL("/mypage?youtube=linked", request.url)
    );
  } catch (e) {
    console.error("YouTube callback error:", e);
    return NextResponse.redirect(
      new URL("/mypage?youtube=error", request.url)
    );
  }
}
