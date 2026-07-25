-- ============================================
-- broadcasts.game_points（テニス系のゲーム内ポイント表示）マイグレーション 2026-07-26
-- テニス（硬式）/ ソフトテニス 対応で、ゲーム内ポイント（15/30/40/Ad・タイブレーク・
-- ソフトテニスのカウント）を視聴側に届けるための表示用 jsonb。
--
-- 値は配信端末のルールエンジンが確定した「表示用文字列」:
--   通常ゲーム        {"home":"40","away":"Ad"}
--   タイブレーク中    {"home":"6","away":"5","tb":true}
--   非テニス/ゲーム間 null
-- 視聴側（webオーバーレイ / mobileオーバーレイ / アーカイブSVG）はテニスのルールを
-- 知らずに文字列をそのまま描画する（point_label / scoreboard_text と同じ既存規範）。
-- セット数=home_sets/away_sets・現セットのゲーム数=home_score/away_score を流用。
--
-- - 書き込み: 配信者本人のみ（既存 RLS「配信者のみ更新可能」+ 列 GRANT UPDATE）
-- - 読み取り: 視聴ページの公開情報のため anon / authenticated に SELECT GRANT
-- - Realtime: broadcasts は publication 登録済みのため追加設定不要（スコアと同経路）
--
-- 背景: broadcasts はテーブルレベル GRANT を REVOKE し安全列だけ列 GRANT する設計
-- （feedback_pg_column_revoke_trap）。新規カラムは同 migration で列 GRANT 必須。
-- ============================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS game_points jsonb;

GRANT SELECT (game_points) ON public.broadcasts TO anon;
GRANT SELECT (game_points) ON public.broadcasts TO authenticated;
GRANT UPDATE (game_points) ON public.broadcasts TO authenticated;
