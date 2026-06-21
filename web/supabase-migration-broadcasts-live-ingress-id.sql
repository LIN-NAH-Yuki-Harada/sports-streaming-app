-- ============================================
-- ネイティブ高画質配信（RTMP → LiveKit Ingress）: DB schema 拡張
-- 2026-06-21
--
-- スマホ（ネイティブアプリ）が WebRTC ではなく RTMP で push して配信ルームに
-- 映像を入れる「本命の高画質経路」のための列を broadcasts に追加する。
-- RTMP は TCP バッファ型なので 4G 上りでも安定して高画質を通せる。
--
-- live_ingress_id は **内部列**（破棄 API でのみ使用）。クライアント（anon/
-- authenticated）には公開しないため、列レベル GRANT は付与しない
-- （既存の live_egress_id と同じ扱い）。service-role の admin client のみ参照する。
--
-- 関連: web/src/lib/livekit-ingress.ts /
--       web/src/app/api/livekit/ingress/start/route.ts /
--       web/src/app/api/livekit/ingress/stop/route.ts
-- ============================================

ALTER TABLE public.broadcasts
  -- LiveKit Ingress (RTMP 取り込み口) の ID。配信終了時に deleteIngress で破棄する。
  -- NULL = ネイティブ RTMP 経路を未使用（WebRTC 配信 or 取り込み口未作成）。
  ADD COLUMN IF NOT EXISTS live_ingress_id text;
