-- ============================================
-- broadcasts.set_results をクライアント(anon/authenticated)に開放するマイグレーション
--
-- 背景: broadcasts は「テーブルレベル REVOKE SELECT → 安全列だけ列レベル GRANT」方式
-- （supabase-migration-broadcasts-rls-tighten.sql）。set_results は列を追加した
-- realtime-scoreboard マイグレーション時に GRANT を付け忘れていたため、クライアントは
-- 読めない。履歴のセット別スコア表示（バレー等：25-18 / 20-25 / 25-23）で必要。
--
-- set_results は各セットの最終得点 {home,away}[] の配列で、機密情報ではない（点数のみ）。
-- ============================================

GRANT SELECT (set_results) ON public.broadcasts TO anon;
GRANT SELECT (set_results) ON public.broadcasts TO authenticated;

-- 確認: 付与されたか
--   SELECT has_column_privilege('authenticated', 'public.broadcasts', 'set_results', 'SELECT');
