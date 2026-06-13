-- ============================================
-- 広告(CM)システム Phase 1 — データ基盤
--
-- コンプラ核心（子どもコンテンツ）: コンテキスト広告のみ（競技/枠でマッチ）。
-- ad_impressions は user_id/IP/cookie 等の PII を一切持たない（COPPA等の唯一の安全解）。
-- 全テーブル RLS 有効・ポリシー無し＝クライアントは読み書き不可。配信(serve)/計測(event)/
-- 管理(admin)は全て service_role(getAdminClient) 経由のサーバーAPIで行う。
-- ============================================

-- キャンペーン（スポンサー単位）
CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sponsor_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,                 -- null = 開始無期限
  ends_at timestamptz,                   -- null = 終了無期限
  target_sports text[] NOT NULL DEFAULT '{}',  -- 空 = 全競技（コンテキスト: 競技名の配列）
  placements text[] NOT NULL DEFAULT '{}',     -- 空 = 全枠（preroll/postroll/waiting 等）
  weight smallint NOT NULL DEFAULT 1,    -- 加重ランダムの重み
  label text NOT NULL DEFAULT 'PR',      -- 広告であることの表示（ステマ規制）
  created_at timestamptz DEFAULT now()
);

-- クリエイティブ（CM動画/静止画）
CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE CASCADE NOT NULL,
  media_type text NOT NULL DEFAULT 'image',  -- 'image' | 'video'
  media_url text NOT NULL,
  duration_seconds smallint,             -- 動画用（任意）
  created_at timestamptz DEFAULT now()
);

-- インプレッション（PIIなし＝campaign_id と枠と時刻のみ）
CREATE TABLE IF NOT EXISTS public.ad_impressions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  placement text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY;
-- ポリシーを作らない＝anon/authenticated は一切アクセス不可。全て service_role 経由。

CREATE INDEX IF NOT EXISTS ad_campaigns_active_idx ON public.ad_campaigns (active);
CREATE INDEX IF NOT EXISTS ad_creatives_campaign_idx ON public.ad_creatives (campaign_id);
CREATE INDEX IF NOT EXISTS ad_impressions_campaign_idx ON public.ad_impressions (campaign_id, created_at DESC);

-- ============================================
-- CM素材の Storage バケット（管理画面からの入稿先）
-- 公開読み取り（CMは公開素材）。アップロードは管理API(service_role)のみ＝RLSバイパス。
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-creatives', 'ad-creatives', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ad-creatives public read" ON storage.objects;
CREATE POLICY "ad-creatives public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'ad-creatives');
