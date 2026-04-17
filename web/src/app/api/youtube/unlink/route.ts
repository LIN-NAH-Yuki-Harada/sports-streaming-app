import { getUser, getAdminClient } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getAdminClient();
    await admin
      .from("profiles")
      .update({
        youtube_channel_id: null,
        youtube_channel_name: null,
        youtube_access_token: null,
        youtube_refresh_token: null,
        youtube_linked_at: null,
      })
      .eq("id", user.id);

    return Response.json({ success: true });
  } catch (e) {
    console.error("YouTube unlink error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
