-- ============================================
-- 無料トライアル・プロモコード管理 マイグレーション (2026-04-23)
-- ============================================
-- 目的:
--   クラブチーム営業配布用の「コード入力で N 日間無料トライアル」を実現するため、
--   promo_codes テーブルと初期コード "SPOT1W" を追加する。
--
-- 仕様:
--   - code (primary key, uppercase): 配布するプロモーションコード文字列
--   - trial_days: 適用される無料トライアル日数
--   - max_uses: 使用回数上限（NULL の場合は無制限）
--   - uses_count: 現在までの使用回数（Webhook で checkout 完了時にインクリメント）
--   - active: 無効化フラグ（手動停止用）
--   - expires_at: 配布期限（過ぎたら validate で reject）
--   - label: オペレーター用メモ（どの用途で配布したか）
--
-- RLS:
--   - 読み取りは Service Role のみ（検証 API が Admin Client 経由で叩く）
--   - 書き込みは Service Role のみ（Webhook が uses_count をインクリメント）
--   - 一般ユーザーには一切公開しない（コード一覧が漏れないように）

CREATE TABLE IF NOT EXISTS public.promo_codes (
  code text PRIMARY KEY,
  trial_days integer NOT NULL CHECK (trial_days BETWEEN 1 AND 90),
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

-- 一般ユーザー・anon には一切のアクセス権を与えない（ポリシー未作成 = deny all）。
-- Service Role は RLS をバイパスするため、Admin Client 経由の API はそのまま動く。

-- updated_at を自動更新するトリガー
CREATE OR REPLACE FUNCTION public.promo_codes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON public.promo_codes;
CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.promo_codes_set_updated_at();

-- 初期コード "SPOT1W" を投入（営業配布用、7日間無料、先着10チーム、2026-05-31 まで）
INSERT INTO public.promo_codes (code, trial_days, max_uses, active, expires_at, label)
VALUES (
  'SPOT1W',
  7,
  10,
  true,
  '2026-05-31T23:59:59+09:00',
  '営業配布用・1週間無料トライアル・先着10チーム（2026-05-31 締切）'
)
ON CONFLICT (code) DO NOTHING;

-- 検証クエリ（実行後の状態確認用、コメントアウトしておく）
-- SELECT code, trial_days, max_uses, uses_count, active, expires_at, label FROM public.promo_codes;
