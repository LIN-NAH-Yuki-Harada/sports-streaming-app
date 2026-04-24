import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component 用: リクエストの Cookie から Supabase セッションを復元する。
 * Server Component は Cookie を書き換えられないため set/remove は no-op にしている。
 */
export async function getServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Server Component では cookie を書けないため noop
        },
      },
    }
  );
}

/**
 * 現在ログインしているユーザーを返す（未ログインなら null）。
 */
export async function getServerUser() {
  const supabase = await getServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
