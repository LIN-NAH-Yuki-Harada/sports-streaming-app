-- ============================================
-- broadcasts.notice（お知らせテロップ）マイグレーション 2026-07-15
-- 配信者が視聴者へ一言お知らせを表示する（「延長タイブレーク中」等）。
-- 少年野球チームの実要望（2026-07-15 受領）を受けた機能。
--
-- - 書き込み: 配信者本人のみ（既存 RLS「配信者のみ更新可能」+ 列 GRANT UPDATE）
-- - 読み取り: 視聴ページのテロップ表示に使う公開情報のため anon / authenticated に SELECT GRANT
-- - Realtime: broadcasts は publication 登録済みのため追加設定不要（スコアと同経路で届く）
--
-- 背景: broadcasts はテーブルレベル GRANT を REVOKE し安全列だけ列 GRANT する設計
-- （feedback_pg_column_revoke_trap）。新規カラムは同 migration で列 GRANT 必須。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS notice text
  CHECK (notice IS NULL OR char_length(notice) <= 100);

GRANT SELECT (notice) ON public.broadcasts TO anon;
GRANT SELECT (notice) ON public.broadcasts TO authenticated;
GRANT UPDATE (notice) ON public.broadcasts TO authenticated;
