-- ============================================
-- broadcasts.live_youtube_broadcast_id 列レベル GRANT 補助 migration
-- 2026-05-02
--
-- PR-1 (supabase-migration-youtube-live.sql) で追加された live_* カラム群の
-- うち、live_youtube_broadcast_id をクライアント (anon / authenticated) から
-- SELECT 可能にする。BROADCAST_PUBLIC_COLUMNS の拡張に伴い必要。
--
-- 背景: PR #64 で broadcasts はテーブルレベル GRANT を REVOKE し、
-- 安全列だけ列レベル GRANT する設計に切り替えた（feedback_pg_column_revoke_trap）。
-- そのため新規追加カラムは個別に GRANT を付ける必要がある。
--
-- live_youtube_broadcast_id は YouTube Live broadcast の公開 video ID であり、
-- youtu.be/{id} の URL 一部として既に YouTube 上で公開可能な値（既存の
-- youtube_video_id と同じ性質）のため、列レベル SELECT GRANT は安全。
--
-- 他の live_* カラム (live_egress_id / live_youtube_stream_id / live_status /
-- live_started_at / live_ended_at / live_error) は配信者専用のため SELECT
-- GRANT は付けない（service_role 経由でのみアクセス）。
-- ============================================

GRANT SELECT (live_youtube_broadcast_id) ON public.broadcasts TO anon;
GRANT SELECT (live_youtube_broadcast_id) ON public.broadcasts TO authenticated;

-- 検証: has_column_privilege で SELECT GRANT が両 role に効いているか確認
DO $$
BEGIN
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'live_youtube_broadcast_id', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to anon failed for broadcasts.live_youtube_broadcast_id';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'live_youtube_broadcast_id', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to authenticated failed for broadcasts.live_youtube_broadcast_id';
  END IF;

  -- 同時に「他の live_* カラムは SELECT 不可」を確認（漏れチェック）
  IF has_column_privilege('anon', 'public.broadcasts', 'live_egress_id', 'SELECT') THEN
    RAISE EXCEPTION 'live_egress_id should NOT be SELECTable by anon';
  END IF;
  IF has_column_privilege('anon', 'public.broadcasts', 'live_error', 'SELECT') THEN
    RAISE EXCEPTION 'live_error should NOT be SELECTable by anon';
  END IF;
END $$;

-- ============================================
-- ロールバック手順（問題時のみ）
-- ============================================
-- REVOKE SELECT (live_youtube_broadcast_id) ON public.broadcasts FROM anon;
-- REVOKE SELECT (live_youtube_broadcast_id) ON public.broadcasts FROM authenticated;
