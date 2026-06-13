import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getAdminClient, getUser } from "./supabase-admin";
import { getServerUser } from "./supabase-server";

/**
 * プラットフォーム管理者かどうかを service_role で判定する。
 * is_platform_admin はクライアントから読めない列なので、必ず service_role 経由で確認する。
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", userId)
    .single();
  if (error || !data) return false;
  return Boolean((data as { is_platform_admin?: boolean }).is_platform_admin);
}

/**
 * Server Component / Server Action 用ガード。
 * 未ログイン or 非管理者なら notFound()（管理画面の存在自体を秘匿＝404）。
 * 通過したら User を返す。
 */
export async function requireAdminPage(): Promise<User> {
  const user = await getServerUser();
  if (!user) notFound();
  if (!(await isPlatformAdmin(user.id))) notFound();
  return user;
}

/**
 * API Route 用ガード。Bearer トークンから本人を導出し管理者か確認する。
 * 失敗時は { error: Response }（401/403）、成功時は { user } を返す。多層防御で
 * レイアウトのガードに加え全ミューテーションAPIの冒頭で必ず呼ぶ。
 */
export async function requireAdmin(
  request: Request,
): Promise<{ user: User } | { error: Response }> {
  const user = await getUser(request);
  if (!user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await isPlatformAdmin(user.id))) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}
