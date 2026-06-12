import { getUser, getAdminClient } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

/**
 * 退会（アカウント削除）API。
 *
 * App Store Guideline 5.1.1(v)（アプリ内アカウント削除）対応のため、配信専用
 * ネイティブアプリ（mobile/）からもこの Web ルートにリンクして退会できるようにする。
 *
 * セキュリティ要点:
 * - 操作対象のユーザー ID は「リクエストボディ」ではなく、必ず検証済みの
 *   Bearer トークン（getUser）から導出する。これにより、他人の id を投げても
 *   自分自身のアカウントしか削除できない（IDOR 防止）。
 * - service_role キーはこの API ルート（サーバー）内でのみ getAdminClient() を
 *   通して使用し、クライアントには一切露出しない。
 *
 * 削除順序（外部キー制約 / 依存関係に従って自分のデータから順に削除）:
 *   1. 自分の broadcasts（broadcaster_id = 自分）
 *   2. 自分の team_members 行（user_id = 自分）
 *   3. 自分の profiles 行（id = 自分）
 *   4. auth ユーザー本体（admin.deleteUser）
 *
 * 注意: スキーマ上は profiles.id → auth.users が ON DELETE CASCADE のため、
 * 4 だけでも 1〜3 は連鎖削除される。ただし「自分のデータを明示的に削除してから
 * auth ユーザーを消す」ことで、将来 CASCADE 設定が変わっても自分のデータが
 * 残らないようにする多層防御とする。
 */
export async function POST(request: Request) {
  try {
    // 認証: ユーザー指定の id は信用せず、検証済みトークンから本人を導出する
    const user = await getUser(request);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getAdminClient();

    // Stripe サブスクリプションがあれば先にキャンセル（課金を止める）
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_subscription_id")
      .eq("id", user.id)
      .single();

    if (profile?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(profile.stripe_subscription_id);
      } catch (e) {
        // 既に解約済みなどで失敗しても退会自体は続行する
        console.error("Stripe subscription cancel error:", e);
      }
    }

    // 1. 自分の配信を削除（必ず broadcaster_id = 本人で絞る）
    const { error: broadcastsError } = await admin
      .from("broadcasts")
      .delete()
      .eq("broadcaster_id", user.id);
    if (broadcastsError) {
      console.error("Delete broadcasts error:", broadcastsError);
      return Response.json(
        { error: "Failed to delete broadcasts" },
        { status: 500 },
      );
    }

    // 2. 自分のチームメンバー所属を削除（必ず user_id = 本人で絞る）
    const { error: membersError } = await admin
      .from("team_members")
      .delete()
      .eq("user_id", user.id);
    if (membersError) {
      console.error("Delete team_members error:", membersError);
      return Response.json(
        { error: "Failed to delete team memberships" },
        { status: 500 },
      );
    }

    // 3. 自分のプロフィール行を削除（必ず id = 本人で絞る）
    const { error: profileError } = await admin
      .from("profiles")
      .delete()
      .eq("id", user.id);
    if (profileError) {
      console.error("Delete profile error:", profileError);
      return Response.json(
        { error: "Failed to delete profile" },
        { status: 500 },
      );
    }

    // 4. auth ユーザー本体を削除（service_role admin 経由）。
    //    自分以外を消せないよう、引数は必ずトークン由来の user.id を使う。
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("Account deletion error:", deleteError);
      return Response.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("Account deletion error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
