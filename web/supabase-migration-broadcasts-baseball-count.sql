-- ============================================
-- 野球カウント（甲子園TV中継風 B/S/O＋走者）用カラム追加マイグレーション
--
-- broadcasts は「テーブルレベル REVOKE SELECT → 安全列だけ列レベル GRANT」方式。
-- 列を追加したら必ず GRANT SELECT(col) を付けないと視聴側(anon/authenticated)が読めない
-- （= point_label の「書くだけ死列」を繰り返さない）。
-- INSERT/UPDATE はテーブルレベル GRANT が残っているため追加不要（配信者は書ける）。
--
-- ★列追加は以下をワンセットで行うこと（チェックリスト）:
--   1) 本SQL（ADD COLUMN + 列GRANT）            ← オーナーがSupabase SQL Editorで実行
--   2) web/src/lib/database.ts の Broadcast 型 ＋ BROADCAST_PUBLIC_COLUMNS に列追記
--   3) mobile/lib/broadcasts.ts updateScore の patch 型に追記
--   4) 描画層: viewer-scoreboard-overlay.tsx（自社CSS）/ scoreboard-canvas.ts（YouTube Egress）
--   いずれかが欠けると「書くだけ死列」になり視聴者に届かない。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS balls smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strikes smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outs smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runners jsonb DEFAULT '{}'::jsonb;

GRANT SELECT (balls) ON public.broadcasts TO anon, authenticated;
GRANT SELECT (strikes) ON public.broadcasts TO anon, authenticated;
GRANT SELECT (outs) ON public.broadcasts TO anon, authenticated;
GRANT SELECT (runners) ON public.broadcasts TO anon, authenticated;

-- 確認:
--   SELECT has_column_privilege('authenticated','public.broadcasts','balls','SELECT'),
--          has_column_privilege('authenticated','public.broadcasts','runners','SELECT');
