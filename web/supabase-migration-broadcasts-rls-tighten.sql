-- ============================================
-- broadcasts テーブルの機密カラム保護（PR #63 不備の根治版）
-- ============================================
-- 旧（PR #63 / supabase-migration-youtube-error-revoke.sql）:
--   REVOKE SELECT (youtube_upload_error) ON public.broadcasts FROM anon, authenticated;
--   ↑ broadcasts にはテーブルレベル `GRANT SELECT TO anon, authenticated` が
--     残っているため、列レベル REVOKE が PostgreSQL の権限モデル上無視される
--     (テーブルレベル GRANT があると列レベル REVOKE は効かない)。
--     `has_column_privilege('anon','public.broadcasts','youtube_upload_error','SELECT')`
--     が true を返してしまう状態だった。
--
-- 新（本 migration）:
--   profiles の PR #50 と同じ「テーブルレベル REVOKE → 安全列だけ列レベル GRANT」
--   パターンに切り替える。これで実体として機密列を遮断できる。
--
-- 機密扱い（GRANT に含めない）:
--   - youtube_upload_error  ← 配信者向け内部ログ（API エラー詳細・スタック含む可能性）
--
-- service_role（API ルート内の admin client）にはテーブルレベル GRANT が引き続き
-- 残るため、egress-webhook など内部処理は影響を受けない。
--
-- 適用方法: Supabase Dashboard の SQL Editor でこの SQL 全体を実行する。
-- ============================================

-- 1. broadcasts のテーブルレベル SELECT を anon/authenticated から剥がす
REVOKE SELECT ON public.broadcasts FROM anon, authenticated;

-- 2. 安全な列だけを列レベル GRANT で再付与
--    schema.sql の基本 17 列 + youtube-archive で追加された 8 列
--    （youtube_upload_error を除く）= 合計 25 列
GRANT SELECT (
  -- 基本（schema.sql）
  id,
  share_code,
  broadcaster_id,
  team_id,
  sport,
  home_team,
  away_team,
  tournament,
  venue,
  home_score,
  away_score,
  home_sets,
  away_sets,
  period,
  status,
  started_at,
  ended_at,
  -- youtube-archive で追加（youtube_upload_error 除く）
  recording_key,
  recording_egress_id,
  recording_file_path,
  youtube_video_id,
  youtube_upload_status,
  youtube_upload_started_at,
  youtube_upload_completed_at,
  youtube_retry_count
) ON public.broadcasts TO anon, authenticated;

-- 3. 検証クエリ（実行後、Supabase Dashboard SQL Editor で確認用）
--
-- -- 機密列が遮断されているか（期待: 両方 false）
-- SELECT
--   has_column_privilege('anon',           'public.broadcasts', 'youtube_upload_error', 'SELECT') AS anon_can_select_error,
--   has_column_privilege('authenticated',  'public.broadcasts', 'youtube_upload_error', 'SELECT') AS auth_can_select_error;
--
-- -- 公開列がアクセス可能か（期待: 両方 true）
-- SELECT
--   has_column_privilege('anon',           'public.broadcasts', 'share_code',             'SELECT') AS anon_can_select_code,
--   has_column_privilege('authenticated',  'public.broadcasts', 'youtube_upload_status',  'SELECT') AS auth_can_select_status;
