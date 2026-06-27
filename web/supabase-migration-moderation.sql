-- ============================================
-- UGCモデレーション（通報・ブロック）マイグレーション
-- App Store Guideline 1.2（User-Generated Content）対応。
-- 配信専用ネイティブアプリ(mobile/)から、認証ユーザーが
--   ・不適切な配信/ユーザーを「通報」(reports)
--   ・迷惑ユーザーを「ブロック」(blocked_users)
-- できるようにする。RLSは auth.uid() ベース（自己参照サブクエリは使わない）。
-- ============================================

-- ---- 通報テーブル ----
-- 認証ユーザーが自分名義(reporter_id=自分)で通報をINSERTできる。
-- 運営は service_role で参照・対応する（一般ユーザーのSELECTは許可しない）。
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reported_broadcast_id uuid REFERENCES public.broadcasts(id) ON DELETE SET NULL,
  reported_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  share_code text,
  reason text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open', -- open / reviewed / actioned / dismissed
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーは「自分名義の通報」だけINSERTできる（他人になりすませない）。
DROP POLICY IF EXISTS "reports_insert_self" ON public.reports;
CREATE POLICY "reports_insert_self" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- SELECT/UPDATE/DELETE のポリシーは作らない＝一般ユーザーは読めない（運営のみ service_role）。
GRANT INSERT ON public.reports TO authenticated;

-- 運営用: 未対応の通報を素早く引くためのインデックス。
CREATE INDEX IF NOT EXISTS reports_status_created_idx
  ON public.reports (status, created_at DESC);


-- ---- ブロックテーブル ----
-- 認証ユーザーが「自分のブロックリスト」を管理する（blocker_id=自分のみ）。
CREATE TABLE IF NOT EXISTS public.blocked_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  blocked_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- 自分のブロック行だけ 参照/追加/削除 できる（auth.uid() = blocker_id）。
-- ※自己参照サブクエリを使わない単純述語なのでRLS再帰の罠には掛からない。
DROP POLICY IF EXISTS "blocked_select_self" ON public.blocked_users;
CREATE POLICY "blocked_select_self" ON public.blocked_users
  FOR SELECT TO authenticated USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocked_insert_self" ON public.blocked_users;
CREATE POLICY "blocked_insert_self" ON public.blocked_users
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocked_delete_self" ON public.blocked_users;
CREATE POLICY "blocked_delete_self" ON public.blocked_users
  FOR DELETE TO authenticated USING (auth.uid() = blocker_id);

GRANT SELECT, INSERT, DELETE ON public.blocked_users TO authenticated;

CREATE INDEX IF NOT EXISTS blocked_users_blocker_idx
  ON public.blocked_users (blocker_id);
