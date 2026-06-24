-- ============================================
-- broadcasts Bunny.net Stream 列追加 migration
-- 2026-06-24
--
-- 目的: 配信トランスポートを LiveKit → ネイティブ RTMP（HaishinKit・端末側スコア焼き込み・
-- 720p60・発熱解決済み）→ Bunny.net Stream へ移行する。配信ごとに Bunny の LiveStream を
-- 発行し、その guid / HLS 再生 URL / 状態を broadcasts に記録する。
--
-- 列:
--   bunny_video_guid    : Bunny LiveStream の GUID（= VOD 化後も再生キー）。公開可。
--   bunny_playback_url  : HLS 再生 URL（.m3u8 ABR マスター）。視聴側がそのまま再生。公開可。
--   bunny_status        : Bunny 配信のライフサイクル。live_status とは独立した状態機械。公開可。
--   bunny_vod_guid      : 録画 VOD の GUID（試合後 YouTube アップロード元）。内部用・非公開。
--
-- ★ streamKey（publish 秘密）と完全 RTMP URL は DB に保存しない。
--   provisioning API（/api/bunny/live/start）のレスポンスでのみ配信者アプリに返す
--   （LiveKit / YouTube の stream key と同じ扱い）。
--
-- 権限設計（feedback_pg_column_revoke_trap）: broadcasts は SELECT のみ列レベル GRANT で
-- 公開している（テーブルレベル SELECT は REVOKE 済）。新規列は個別に SELECT GRANT が必要。
-- bunny_vod_guid は配信者内部用なので GRANT しない（service-role のみ参照）。
-- INSERT/UPDATE はテーブルレベル GRANT が残っているため追加 GRANT 不要。
--
-- ★ デプロイ順序（重要）: この migration を本番 Supabase に適用してから、
--   bunny_* 列を SELECT するコード（視聴プレイヤー等）をデプロイすること。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS bunny_video_guid   text,
  ADD COLUMN IF NOT EXISTS bunny_playback_url text,
  ADD COLUMN IF NOT EXISTS bunny_vod_guid     text,
  ADD COLUMN IF NOT EXISTS bunny_status       text;

-- bunny_status の値域を制約（NULL は許可＝Bunny を使わない配信）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broadcasts_bunny_status_check'
  ) THEN
    ALTER TABLE public.broadcasts
      ADD CONSTRAINT broadcasts_bunny_status_check
      CHECK (bunny_status IN ('creating', 'live', 'ended', 'failed', 'vod_processing'));
  END IF;
END $$;

-- 公開列（視聴側で再生 URL / 状態判定に使う）に列レベル SELECT GRANT。
GRANT SELECT (bunny_video_guid, bunny_playback_url, bunny_status) ON public.broadcasts TO anon;
GRANT SELECT (bunny_video_guid, bunny_playback_url, bunny_status) ON public.broadcasts TO authenticated;

-- cron cleanup が live/creating を拾うための部分インデックス。
CREATE INDEX IF NOT EXISTS idx_broadcasts_bunny_status
  ON public.broadcasts (bunny_status) WHERE bunny_status IS NOT NULL;

-- 検証: 公開列の SELECT GRANT が両 role に効いているか確認（has_column_privilege）。
DO $$
BEGIN
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'bunny_playback_url', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to anon failed for broadcasts.bunny_playback_url';
  END IF;
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'bunny_video_guid', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to anon failed for broadcasts.bunny_video_guid';
  END IF;
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'bunny_status', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to anon failed for broadcasts.bunny_status';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'bunny_playback_url', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to authenticated failed for broadcasts.bunny_playback_url';
  END IF;
END $$;

-- ============================================
-- ロールバック手順（問題時のみ）
-- ============================================
-- REVOKE SELECT (bunny_video_guid, bunny_playback_url, bunny_status) ON public.broadcasts FROM anon, authenticated;
-- DROP INDEX IF EXISTS idx_broadcasts_bunny_status;
-- ALTER TABLE public.broadcasts DROP CONSTRAINT IF EXISTS broadcasts_bunny_status_check;
-- ALTER TABLE public.broadcasts
--   DROP COLUMN IF EXISTS bunny_video_guid,
--   DROP COLUMN IF EXISTS bunny_playback_url,
--   DROP COLUMN IF EXISTS bunny_vod_guid,
--   DROP COLUMN IF EXISTS bunny_status;
