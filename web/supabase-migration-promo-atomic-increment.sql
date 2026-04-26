-- ============================================
-- promo_codes.uses_count の atomic increment 用 RPC 関数
-- ============================================
-- 旧:
--   incrementPromoUsage が SELECT → +1 → UPDATE の 3 段階で行われていた。
--   2 ユーザーが同時に同じコードで checkout すると lost update が発生し、
--   uses_count が 1 しか進まない race condition があった
--   （max_uses 超過しても誤って受け付けてしまう恐れ）。
--
-- 新:
--   atomic UPDATE を行う RPC 関数を作成し、JS 側からは rpc() 1 発で呼ぶ。
--   PostgreSQL の UPDATE は単一文で atomic に評価されるため、同時実行下でも
--   uses_count が正しく加算される。
--
-- セキュリティ:
--   - SECURITY DEFINER で関数所有者 (postgres) の権限で実行
--   - search_path = public 明示で search_path injection 対策
--   - anon/authenticated には EXECUTE 権を付与しない（service_role 経由のみ）
--     これによりクライアントから直接叩かれるリスクをゼロに
-- ============================================

CREATE OR REPLACE FUNCTION public.increment_promo_usage(promo_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.promo_codes
  SET uses_count = uses_count + 1
  WHERE code = upper(trim(promo_code));
END;
$$;

-- anon/authenticated には EXECUTE を許可しない（service_role 経由のみ呼べるようにする）
REVOKE EXECUTE ON FUNCTION public.increment_promo_usage(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_promo_usage(text) FROM anon, authenticated;

-- 適用確認用クエリ（実行不要）
-- SELECT proname, prosecdef, proacl
-- FROM pg_proc
-- WHERE proname = 'increment_promo_usage' AND pronamespace = 'public'::regnamespace;
-- 期待: prosecdef=true（SECURITY DEFINER 有効）、proacl に anon/authenticated 含まれない
