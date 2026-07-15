-- ============================================
-- 運用アラート送信記録（alert_log）マイグレーション
-- /api/cron/alerts が「同じ障害を二度通知しない」ための送信済み記録。
-- 対象障害:
--   ・broadcasts.live_error（YouTube Live 連携などライブ配信の失敗）
--   ・broadcasts.youtube_upload_status = 'failed'（アーカイブ処理の失敗）
-- 読み書きは service_role（cron）のみ。一般ユーザーのアクセスは不可。
-- ============================================

CREATE TABLE IF NOT EXISTS public.alert_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  kind text NOT NULL,   -- 'live_error' | 'archive_failed'
  ref_id text NOT NULL, -- 対象 broadcasts.id
  detail text,          -- 通知時点のエラーメッセージ（診断用スナップショット）
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id)
);

ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;

-- ポリシーは作らない = anon / authenticated は行アクセス不可（service_role は RLS 素通し）。
-- テーブルレベル権限も剥がしておく（列 GRANT 再付与事故の防止）。
REVOKE ALL ON TABLE public.alert_log FROM anon, authenticated;
