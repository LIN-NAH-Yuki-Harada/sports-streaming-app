-- ============================================
-- broadcasts.scoreboard_burned_in 列追加 migration
-- 2026-06-08
--
-- 目的: 発熱対策（Phase 1-A）。配信スマホでのスコア「焼き込み（canvas 合成）」を
-- プランで出し分けるため、「この配信は映像にスコアが焼き込まれているか」を
-- 配信ごとに記録する。視聴ページはこのフラグで以下を分岐する:
--   - true  (焼き込みあり=従来): 映像にスコアが乗っているので視聴側オーバーレイ不要。
--   - false (焼き込みOFF=¥300等): 視聴側で CSS スコアオーバーレイを描画し、
--                                 iPhone はフェイク全画面に切替（全画面でもスコアが見える）。
--
-- 既定値 true = 後方互換（既存行・未設定経路はすべて従来どおり「焼き込みあり」扱い）。
--
-- 権限設計（feedback_pg_column_revoke_trap）: broadcasts は SELECT のみ列レベル
-- GRANT で公開している（テーブルレベル SELECT は REVOKE 済）。新規列は個別に
-- SELECT GRANT を付ける必要がある。INSERT/UPDATE はテーブルレベル GRANT が
-- 残っているため、配信者(authenticated)は新列も書き込める（追加 GRANT 不要）。
-- scoreboard_burned_in は配信状態の公開情報（true/false のみ）なので SELECT 公開は安全。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS scoreboard_burned_in boolean NOT NULL DEFAULT true;

GRANT SELECT (scoreboard_burned_in) ON public.broadcasts TO anon;
GRANT SELECT (scoreboard_burned_in) ON public.broadcasts TO authenticated;

-- 検証: has_column_privilege で SELECT GRANT が両 role に効いているか確認
DO $$
BEGIN
  IF NOT has_column_privilege('anon', 'public.broadcasts', 'scoreboard_burned_in', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to anon failed for broadcasts.scoreboard_burned_in';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.broadcasts', 'scoreboard_burned_in', 'SELECT') THEN
    RAISE EXCEPTION 'GRANT to authenticated failed for broadcasts.scoreboard_burned_in';
  END IF;
END $$;

-- ============================================
-- ロールバック手順（問題時のみ）
-- ============================================
-- REVOKE SELECT (scoreboard_burned_in) ON public.broadcasts FROM anon, authenticated;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS scoreboard_burned_in;
