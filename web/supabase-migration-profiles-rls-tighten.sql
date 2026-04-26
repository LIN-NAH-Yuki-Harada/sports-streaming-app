-- ============================================
-- profiles テーブルの機密カラム保護 (PR #50)
-- ============================================
-- 旧: SELECT ポリシーが using (true) のため、認証済みクライアントが
--     他人の youtube_access_token / youtube_refresh_token / stripe_customer_id /
--     stripe_subscription_id を Supabase クライアント経由で取得可能だった。
-- 新: column-level GRANT で公開フィールドのみクライアントに許可。
--     機密カラムは service_role 経由（API ルート）でのみアクセス可。
--
-- 適用方法: Supabase Dashboard の SQL Editor でこの SQL 全体を実行する。
-- ============================================

-- 1. 全 SELECT 権限を一旦 REVOKE（カラム単位の許可を上書きするため）
REVOKE SELECT ON public.profiles FROM authenticated, anon;

-- 2. authenticated（ログインユーザー）には公開フィールド + 自分用カラムのみ GRANT
--    ※ plan / trial_* / subscription_status / current_period_end / youtube_channel_*
--      は他人のも取得可能だが、個人を特定できる情報ではないため許容。
--    ※ 真に秘匿すべきトークン類だけを GRANT から外す。
GRANT SELECT (
  id,
  display_name,
  avatar_url,
  plan,
  trial_used,
  trial_seconds_used,
  youtube_channel_id,
  youtube_channel_name,
  youtube_linked_at,
  subscription_status,
  current_period_end,
  created_at,
  updated_at
) ON public.profiles TO authenticated;

-- 3. anon（未ログイン）には公開表示用フィールドのみ GRANT
GRANT SELECT (id, display_name, avatar_url) ON public.profiles TO anon;

-- 4. 機密カラム（GRANT しない = クライアントから完全遮断）:
--      - youtube_access_token
--      - youtube_refresh_token
--      - stripe_customer_id
--      - stripe_subscription_id
--    これらは service_role 経由（API ルートで supabase admin client）のみアクセス可。
--
--    クライアントが select("*") するとカラム不足で 400 エラーになるため、
--    アプリケーション側のクエリは明示的なカラムリストに書き換える必要あり
--    （database.ts の getProfile() を修正）。

-- 5. 検証クエリ（実行後、Supabase Dashboard SQL Editor で確認用）:
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public' AND table_name = 'profiles'
-- ORDER BY grantee, column_name;
