/**
 * 自前配信サーバー（MediaMTX on VPS）配信パイプラインの ON/OFF スイッチ。
 *
 * - false: /api/stream/provision は 503 → アプリは旧 LiveKit 経路にフォールバック
 * - true:  配信者アプリに RTMP 配信先（認証付）＋ HLS 視聴URL を発行する
 *
 * 本番有効化の前提（オーナー作業）:
 *   Vercel env: STREAM_HOST=live.live-spotch.com / STREAM_PUBLISH_SECRET=<MediaMTX spotch pass>
 *   → NEXT_PUBLIC_STREAM_SELFHOST=true → Redeploy
 *
 * NEXT_PUBLIC_ なので Server/API/Client いずれからも参照可。変更後は Redeploy 必須。
 * モバイルは別ビルドのため、provision の 503/失敗を見て自動フォールバックする。
 */
export function isSelfHostStreamEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STREAM_SELFHOST === "true";
}
