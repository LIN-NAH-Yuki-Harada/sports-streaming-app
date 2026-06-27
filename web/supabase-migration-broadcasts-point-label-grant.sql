-- ============================================
-- broadcasts.point_label をクライアント(anon/authenticated)に開放するマイグレーション
--
-- 背景: broadcasts は「テーブルレベル REVOKE SELECT → 安全列だけ列レベル GRANT」方式
-- （supabase-migration-broadcasts-rls-tighten.sql）。point_label 列（バレーのセット/
-- マッチポイント表示）は 2026-06-12 に列追加＋本番DBへ手動で GRANT 済みだが、追跡用の
-- migration ファイルが欠落していた。DB復元時に履歴/視聴クエリが本番だけ落ちるのを防ぐため
-- 記録として追加（point_label は得点状況のラベルのみで機密情報ではない）。
-- ※本番には既に適用済みのため、この再実行は no-op（GRANT は冪等）。
-- ============================================

GRANT SELECT (point_label) ON public.broadcasts TO anon;
GRANT SELECT (point_label) ON public.broadcasts TO authenticated;

-- 確認:
--   SELECT has_column_privilege('authenticated', 'public.broadcasts', 'point_label', 'SELECT');
