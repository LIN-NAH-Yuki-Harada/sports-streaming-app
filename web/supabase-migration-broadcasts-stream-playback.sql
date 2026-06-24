-- ============================================
-- broadcasts.stream_playback_url 列追加 migration
-- 2026-06-24
--
-- 目的: 配信トランスポートを 自前 MediaMTX(VPS) パススルー に移行。配信者アプリが
-- /api/stream/provision を叩くと、視聴用 HLS URL（https://live.live-spotch.com/<shareCode>/index.m3u8）が
-- ここに保存される。視聴側（/watch・mobile WatchScreen）はこの列があれば HLS プレイヤーで再生し、
-- 無ければ従来 LiveKit にフォールバックする（=移行期の出し分け指標）。
--
-- ★ publish secret や完全 RTMP URL はここに保存しない（provision API のレスポンスでのみ配信者に渡す）。
--
-- 権限設計（feedback_pg_column_revoke_trap）: broadcasts は SELECT のみ列レベル GRANT で公開。
-- stream_playback_url は視聴に必要な公開情報なので anon/authenticated に SELECT GRANT。
-- INSERT/UPDATE はテーブルレベル GRANT が残っているため追加 GRANT 不要（書き込みは service_role）。
--
-- ★ デプロイ順序: この migration を本番 Supabase に適用してから、
--   stream_playback_url を SELECT するコード（視聴プレイヤー等）をデプロイすること。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS stream_playback_url text;

GRANT SELECT (stream_playback_url) ON public.broadcasts TO anon;
GRANT SELECT (stream_playback_url) ON public.broadcasts TO authenticated;

-- 検証: 公開列の SELECT GRANT が両 role に効いているか
DO $$
BEGIN
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'stream_playback_url', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to anon failed for broadcasts.stream_playback_url';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'stream_playback_url', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to authenticated failed for broadcasts.stream_playback_url';
  END IF;
END $$;

-- ============================================
-- ロールバック手順（問題時のみ）
-- ============================================
-- REVOKE SELECT (stream_playback_url) ON public.broadcasts FROM anon, authenticated;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS stream_playback_url;
