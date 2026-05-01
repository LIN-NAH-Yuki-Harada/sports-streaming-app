-- PR-5: profiles.youtube_live_* カラムへの列レベル GRANT 追加
--
-- profiles テーブルは「テーブルレベル SELECT/UPDATE は REVOKE 済 +
-- 安全列だけ列レベル GRANT」という列単位アクセス制御パターンを採用している
-- （PR #50 / PR #63 のパターン）。
--
-- PR-1 (#86) で youtube_live_enabled / youtube_live_privacy を ALTER で追加した
-- 際に列レベル GRANT が漏れていたため、クライアント（authenticated ロール）から
-- これらのカラムを SELECT / UPDATE できない状態だった。
--
-- 本 migration でその GRANT を補い、マイページの Live 中継 ON/OFF トグル
-- （PR-5 UI）から自分のプロフィールを読み書きできるようにする。
--
-- 機密情報ではない（公開動画の privacy 設定および opt-in フラグ）ため、
-- authenticated ロール全体に GRANT してよい。RLS の行ポリシーで「自分の行のみ」
-- が担保されているため、他人の値が読み書きされることはない。

GRANT SELECT (youtube_live_enabled, youtube_live_privacy)
  ON public.profiles TO authenticated;

GRANT UPDATE (youtube_live_enabled, youtube_live_privacy)
  ON public.profiles TO authenticated;

-- 検証ブロック（実行時に権限が反映されているか自己チェック）
DO $$
BEGIN
  ASSERT has_column_privilege(
    'authenticated', 'public.profiles', 'youtube_live_enabled', 'SELECT'
  ), 'GRANT SELECT (youtube_live_enabled) failed';
  ASSERT has_column_privilege(
    'authenticated', 'public.profiles', 'youtube_live_enabled', 'UPDATE'
  ), 'GRANT UPDATE (youtube_live_enabled) failed';
  ASSERT has_column_privilege(
    'authenticated', 'public.profiles', 'youtube_live_privacy', 'SELECT'
  ), 'GRANT SELECT (youtube_live_privacy) failed';
  ASSERT has_column_privilege(
    'authenticated', 'public.profiles', 'youtube_live_privacy', 'UPDATE'
  ), 'GRANT UPDATE (youtube_live_privacy) failed';
END;
$$;

-- ロールバック（必要時）:
-- REVOKE SELECT (youtube_live_enabled, youtube_live_privacy)
--   ON public.profiles FROM authenticated;
-- REVOKE UPDATE (youtube_live_enabled, youtube_live_privacy)
--   ON public.profiles FROM authenticated;
