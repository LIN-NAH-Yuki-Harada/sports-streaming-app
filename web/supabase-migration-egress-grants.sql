-- ============================================
-- YouTube アーカイブ機能の broadcasts カラム GRANT 追補
--
-- supabase-migration-youtube-archive.sql (Phase 1) で broadcasts に
-- recording_*, youtube_* カラムを追加したが、GRANT 文が同梱されておらず
-- anon/authenticated から SELECT できない状態だった（PR #50 で profiles を
-- 同様に絞った時の教訓パターン）。
--
-- 視聴ページは share_code で broadcasts を anon SELECT する設計のため、
-- アーカイブ表示時に列が見えないと 400 で死ぬ。これを補う。
--
-- 機密情報の youtube_upload_error は配信者向けの内部ログなので GRANT に含めない。
-- ============================================

GRANT SELECT (
  recording_key,
  recording_egress_id,
  recording_file_path,
  youtube_video_id,
  youtube_upload_status,
  youtube_upload_started_at,
  youtube_upload_completed_at,
  youtube_retry_count
) ON public.broadcasts TO anon, authenticated;

-- 適用確認用クエリ（実行不要、SQL Editor で別途叩いてください）
-- SELECT grantee, column_name
-- FROM information_schema.column_privileges
-- WHERE table_name = 'broadcasts'
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type = 'SELECT'
--   AND (column_name LIKE 'recording_%' OR column_name LIKE 'youtube_%')
-- ORDER BY grantee, column_name;
-- 期待: anon と authenticated に対し各 8 列分の SELECT 権限行（合計 16 行）
