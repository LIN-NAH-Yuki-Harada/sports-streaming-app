import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // ユーザーのトークンを検証してIDを取得
    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);

    if (userError || !user) {
      return Response.json({ error: "Invalid token" }, { status: 401 });
    }

    // Admin権限でユーザーを削除
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error("Account deletion error:", deleteError);
      return Response.json({ error: "Failed to delete account" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("Account deletion error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
