-- ============================================
-- YouTube連携 マイグレーション
-- ============================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS youtube_channel_id text,
  ADD COLUMN IF NOT EXISTS youtube_channel_name text,
  ADD COLUMN IF NOT EXISTS youtube_access_token text,
  ADD COLUMN IF NOT EXISTS youtube_refresh_token text,
  ADD COLUMN IF NOT EXISTS youtube_linked_at timestamptz;
