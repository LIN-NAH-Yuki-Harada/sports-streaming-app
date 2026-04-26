-- ============================================
-- broadcasts.youtube_upload_error をクライアントから遮断
--
-- youtube_upload_error は配信者向けの内部ログ（API エラー詳細・スタック情報など
-- 機密情報を含む可能性）。Phase 1 の supabase-migration-youtube-archive.sql で
-- 追加されたが、broadcasts にはテーブルレベル GRANT があるため anon/authenticated
-- からも見える状態だった（Sprint A1 の column_privileges 確認で発覚）。
--
-- Sprint A3 の webhook が実際にエラーメッセージを書き込み始める前に、
-- 列レベル REVOKE で個別に絞る。postgres / service_role には残るので、
-- service_role 経由（API ルート内）からは引き続き読み書き可能。
-- ============================================

REVOKE SELECT (youtube_upload_error) ON public.broadcasts FROM anon, authenticated;

-- 適用確認用クエリ（実行不要）
-- SELECT grantee, column_name FROM information_schema.column_privileges
-- WHERE table_name='broadcasts' AND column_name='youtube_upload_error'
--   AND grantee IN ('anon', 'authenticated');
-- 期待: 0 行
