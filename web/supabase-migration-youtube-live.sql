-- ============================================
-- Live 中継移行 PR-1: DB schema 拡張
-- 2026-05-01
--
-- YouTube Live RTMP push（リアルタイム配信）のメタデータを broadcasts に追加し、
-- 配信者ごとの opt-in トグルを profiles に追加する。
-- フィーチャーフラグ NEXT_PUBLIC_LIVE_ARCHIVE が false の間はこれらのカラムは
-- 一切書き込まれず、旧パイプライン（録画→YouTube アップロード）が継続稼働する。
--
-- 対応 PR: PR-1（DB + flag）
-- 後続: PR-2 (YouTube Live API lib + OAuth scope) /
--       PR-3 (RTMP egress lib + start/stop API) /
--       PR-4 (broadcast/page.tsx 切替) /
--       PR-5 (mypage UI) /
--       PR-6 (旧パイプライン撤去)
-- ============================================

-- 1. broadcasts テーブルに Live 中継トラッキングカラムを追加
ALTER TABLE public.broadcasts
  -- LiveKit Egress (RTMP push) の egress ID。停止 API 呼出と webhook 突合に使用。
  ADD COLUMN IF NOT EXISTS live_egress_id text,
  -- YouTube Live broadcast resource ID。視聴 URL 生成 / transition 呼出に使用。
  ADD COLUMN IF NOT EXISTS live_youtube_broadcast_id text,
  -- YouTube Live stream resource ID。broadcast との bind 用。
  ADD COLUMN IF NOT EXISTS live_youtube_stream_id text,
  -- Live 中継フローの状態。NULL = 旧パイプライン or Live 中継未使用。
  -- 値が入った時点で新パイプラインに切替済みを意味する。
  ADD COLUMN IF NOT EXISTS live_status text
    CHECK (live_status IS NULL OR live_status IN
      ('pending', 'creating', 'live', 'ended', 'failed')),
  -- Live 配信開始 timestamp（YouTube transition 完了時に書き込み）
  ADD COLUMN IF NOT EXISTS live_started_at timestamptz,
  -- Live 配信終了 timestamp
  ADD COLUMN IF NOT EXISTS live_ended_at timestamptz,
  -- 失敗時のエラーメッセージ（人読可能）
  ADD COLUMN IF NOT EXISTS live_error text;

-- 2. profiles テーブルに Live 中継 opt-in フラグを追加
ALTER TABLE public.profiles
  -- 配信者個別の Live 中継機能 ON/OFF。
  -- マイページで toggle 可能（PR-5 で実装）。
  -- チームプラン契約者のみ true に変更可能（クライアントでガード）。
  ADD COLUMN IF NOT EXISTS youtube_live_enabled boolean DEFAULT false,
  -- 新規 Live broadcast のデフォルト公開範囲。
  -- 当面は 'unlisted' 固定運用（共有コードと相性良い）。
  ADD COLUMN IF NOT EXISTS youtube_live_privacy text DEFAULT 'unlisted'
    CHECK (youtube_live_privacy IN ('unlisted', 'private', 'public'));

-- 3. インデックス: 活性 Live 配信の高速検索
--    cron / webhook 処理で「現在進行中の Live 配信」を引くための WHERE 絞り込み付き。
CREATE INDEX IF NOT EXISTS idx_broadcasts_live_status
  ON public.broadcasts(live_status)
  WHERE live_status IN ('pending', 'creating', 'live');

-- 4. Realtime publication
--    broadcasts は既に publication 登録済 (supabase-migration-youtube-archive.sql)
--    REPLICA IDENTITY FULL も既設定済 → 新カラムは自動的に Realtime に流れる。
--    追加対応不要。

-- ============================================
-- ロールバック手順（問題時のみ）
-- ============================================
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS live_egress_id;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS live_youtube_broadcast_id;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS live_youtube_stream_id;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS live_status;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS live_started_at;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS live_ended_at;
-- ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS live_error;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS youtube_live_enabled;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS youtube_live_privacy;
-- DROP INDEX IF EXISTS idx_broadcasts_live_status;
