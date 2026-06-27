-- ③ サーバー側スコア焼き込み用: 試合中のスコア変化を時刻付きで記録するテーブル。
-- アーカイブワーカー(VPS)が、この時系列を使って録画(MediaMTX)に ffmpeg でスコアを
-- 焼き込む（ASS字幕）。配信中は配信者(mobile)が score 変更ごとに1行 insert する。
--
-- scoreboard_text = その時点で表示する 1 行（例 "ホーム 2 - 1 アウェイ ／ 後半"）。
-- 整形は mobile 側で行い、ワーカーは text をそのまま字幕にするだけ（formatting をサーバーに
-- 複製しない＝シンプル）。at は UTC（worker は録画ファイルの開始時刻に対する相対秒に変換）。

CREATE TABLE IF NOT EXISTS public.broadcast_score_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  scoreboard_text text NOT NULL,
  -- ③ SVG スコアボード焼き込み用の構造化スコア（teams は broadcasts 行から取得）
  home_score int,
  away_score int,
  home_sets int,
  away_sets int,
  period text
);

-- 既存テーブル（先に scoreboard_text のみで作成済）への列追加（冪等）。
ALTER TABLE public.broadcast_score_events
  ADD COLUMN IF NOT EXISTS home_score int,
  ADD COLUMN IF NOT EXISTS away_score int,
  ADD COLUMN IF NOT EXISTS home_sets int,
  ADD COLUMN IF NOT EXISTS away_sets int,
  ADD COLUMN IF NOT EXISTS period text;

CREATE INDEX IF NOT EXISTS idx_bse_broadcast_at
  ON public.broadcast_score_events(broadcast_id, at);

-- RLS: 配信者は自分が broadcaster の配信にのみ insert 可。worker は service_role で RLS バイパス。
ALTER TABLE public.broadcast_score_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bse_broadcaster_insert ON public.broadcast_score_events;
CREATE POLICY bse_broadcaster_insert ON public.broadcast_score_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.broadcasts b
      WHERE b.id = broadcast_id AND b.broadcaster_id = auth.uid()
    )
  );

GRANT INSERT ON public.broadcast_score_events TO authenticated;

-- 検証:
--   SELECT has_table_privilege('authenticated','public.broadcast_score_events','INSERT'); -- t
