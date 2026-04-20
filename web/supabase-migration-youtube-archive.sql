-- ============================================
-- YouTube自動アーカイブ機能 マイグレーション (Phase 2)
-- Phase 1 (YouTube OAuth連携) に続く拡張
-- ============================================

-- 1. broadcasts テーブルに録画・アップロード関連カラムを追加
ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS recording_key text,
  ADD COLUMN IF NOT EXISTS recording_egress_id text,
  ADD COLUMN IF NOT EXISTS recording_file_path text,
  ADD COLUMN IF NOT EXISTS youtube_video_id text,
  ADD COLUMN IF NOT EXISTS youtube_upload_status text
    CHECK (youtube_upload_status IN ('pending', 'recording', 'uploading', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS youtube_upload_error text,
  ADD COLUMN IF NOT EXISTS youtube_upload_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_upload_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_retry_count int DEFAULT 0;

-- 2. profiles に自動アーカイブ ON/OFF トグルを追加
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS youtube_auto_archive boolean DEFAULT true;

-- 3. 視聴者・配信者がアップロード状況を追跡できるよう Realtime 公開設定
--    (publication は既に作成済み想定。なければ追加)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'broadcasts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcasts;
  END IF;
END $$;

-- REPLICA IDENTITY FULL: UPDATE イベントで全カラムの変更値を取得するため
ALTER TABLE public.broadcasts REPLICA IDENTITY FULL;

-- 4. インデックス: アップロード待ちジョブの検索高速化
CREATE INDEX IF NOT EXISTS idx_broadcasts_upload_status
  ON public.broadcasts(youtube_upload_status)
  WHERE youtube_upload_status IN ('pending', 'recording', 'uploading');

-- 5. インデックス: 配信者ごとのアーカイブ一覧
CREATE INDEX IF NOT EXISTS idx_broadcasts_broadcaster_youtube
  ON public.broadcasts(broadcaster_id, youtube_video_id)
  WHERE youtube_video_id IS NOT NULL;
