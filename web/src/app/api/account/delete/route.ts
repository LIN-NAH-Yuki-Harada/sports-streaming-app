import { getUser, getAdminClient } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getAdminClient();

    // Stripeサブスクリプションがあればキャンセル
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_subscription_id")
      .eq("id", user.id)
      .single();

    if (profile?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(profile.stripe_subscription_id);
      } catch (e) {
        console.error("Stripe subscription cancel error:", e);
        // Stripeキャンセルに失敗しても退会は続行（既に解約済みの場合など）
      }
    }

    // アバター画像ファイルをStorageから削除
    // （ユーザー削除のCASCADEはDBのprofiles行だけを消し、Storageの実ファイルは残るため、
    //   ここで avatars/<user_id>/ 配下のファイルを明示的に削除する）
    try {
      const { data: avatarFiles } = await admin.storage
        .from("avatars")
        .list(user.id);
      if (avatarFiles && avatarFiles.length > 0) {
        await admin.storage
          .from("avatars")
          .remove(avatarFiles.map((f) => `${user.id}/${f.name}`));
      }
    } catch (e) {
      console.error("Avatar storage cleanup error:", e);
      // アバター削除に失敗しても退会は続行
    }

    // Admin権限でユーザーを削除（CASCADE でプロフィール・チーム・配信も削除）
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

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
