-- ============================================
-- 累積トライアル管理 マイグレーション (2026-04-22)
-- ============================================
-- 目的:
--   旧来の trial_used (boolean) を trial_seconds_used (integer) に拡張し、
--   無料お試し10分を「1回限り」から「累積10分・複数セッションで分割可」に変更する。
--
-- 安全性:
--   - 旧カラム trial_used は残置（ロールバック互換性のため、後日別マイグレーションで削除予定）
--   - 既存の trial_used = true ユーザーは trial_seconds_used = 600 で backfill（消費済み扱い）
--   - 新規ユーザーは trial_seconds_used = 0
--   - アプリは trial_seconds_used >= 600 でトライアル終了と判定
--
-- 上限制御:
--   600秒 (10分) はアプリケーション側で強制（API: trial-consume）。
--   DB 側の CHECK 制約は将来的なキャンペーン等で上限変更しやすいよう敢えて付けない。

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_seconds_used integer NOT NULL DEFAULT 0;

-- 既存の trial_used = true ユーザーを backfill（重複実行に強い：trial_seconds_used が 0 の行のみ更新）
UPDATE public.profiles
SET trial_seconds_used = 600
WHERE trial_used = true
  AND trial_seconds_used = 0;

-- 検証クエリ（実行後の状態確認用、コメントアウトしておく）
-- SELECT
--   COUNT(*) FILTER (WHERE trial_used = true) AS legacy_used_total,
--   COUNT(*) FILTER (WHERE trial_seconds_used >= 600) AS new_consumed_total,
--   COUNT(*) FILTER (WHERE trial_seconds_used > 0 AND trial_seconds_used < 600) AS new_partial_total
-- FROM public.profiles;
