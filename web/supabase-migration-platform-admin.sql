-- ============================================
-- プラットフォーム管理者フラグ（管理画面 /admin の認可の真実の源）
--
-- profiles は「テーブルレベル SELECT/UPDATE を REVOKE 済み → 安全列だけ列レベル GRANT」方式
-- （実測: anon/authenticated にテーブルGRANT無し）。よって is_platform_admin を追加し
-- 列GRANTを付けなければ、クライアントは読みも書きもできない＝自己昇格不可・安全。
-- 管理者判定は service_role(getAdminClient)経由のみで行う（admin-auth.ts）。
--
-- ※ revoke 系は一切流さない（既存のプロフィール更新を壊さないため・レビュー指摘）。
-- ============================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- 管理者の付与（オーナー自身のUUIDに対して・SQL Editorで手動実行）:
--   UPDATE public.profiles SET is_platform_admin = true WHERE id = '<オーナーのprofiles.id>';
-- 自分のUUIDが分からない場合:
--   SELECT id, display_name FROM public.profiles ORDER BY created_at LIMIT 50;
