-- ============================================
-- broadcasts.live_status 列レベル GRANT 補助 migration
-- 2026-05-02
--
-- PR-1 で追加された live_* カラムのうち、live_status をクライアント
-- (anon / authenticated) から SELECT 可能にする。
-- 履歴 UI を新パイプライン (live_status) と旧パイプライン
-- (youtube_upload_status) の両方に対応させるため必要。
--
-- 背景: PR #64 で broadcasts はテーブルレベル GRANT を REVOKE し、
-- 安全列だけ列レベル GRANT する設計に切り替えた（feedback_pg_column_revoke_trap）。
-- 新規追加カラムは個別に GRANT を付ける必要がある。
--
-- live_status は配信状態の公開情報（'pending' / 'creating' / 'live' /
-- 'ended' / 'failed' のいずれか・既存 status カラムと同じ性質）のため、
-- 列レベル SELECT GRANT は安全。
--
-- 他の live_* カラム (live_egress_id / live_youtube_stream_id /
-- live_started_at / live_ended_at / live_error) は配信者専用のため SELECT
-- GRANT は付けない（service_role 経由でのみアクセス）。
-- ============================================

GRANT SELECT (live_status) ON public.broadcasts TO anon;
GRANT SELECT (live_status) ON public.broadcasts TO authenticated;

-- 検証: has_column_privilege で SELECT GRANT が両 role に効いているか確認
DO $$
BEGIN
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'live_status', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to anon failed for broadcasts.live_status';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'live_status', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to authenticated failed for broadcasts.live_status';
  END IF;

  -- 漏れチェック: 他の live_* カラムは SELECT 不可のままか
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
-- REVOKE SELECT (live_status) ON public.broadcasts FROM anon;
-- REVOKE SELECT (live_status) ON public.broadcasts FROM authenticated;
