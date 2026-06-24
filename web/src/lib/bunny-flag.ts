/**
 * Bunny.net Stream 配信パイプライン全体の ON/OFF スイッチ。
 *
 * - false: Bunny プロビジョニング API（/api/bunny/live/*）は無効。配信元は旧 LiveKit 経路のまま。
 * - true:  /api/bunny/live/start が実際に Bunny ライブを発行し、ネイティブ RTMP 配信を受ける。
 *
 * 本番有効化の前提（オーナー作業）:
 *   1. Bunny.net アカウント + Stream Video Library 作成
 *   2. Vercel env に BUNNY_STREAM_API_KEY / BUNNY_LIBRARY_ID / BUNNY_RTMP_INGEST_URL を登録
 *   3. NEXT_PUBLIC_BUNNY_LIVE=true にして Redeploy
 *
 * NEXT_PUBLIC_ プレフィックスにより Server / API ルート / Client いずれからも参照可能。
 * バンドル時に値が固定されるため、変更後は必ず Redeploy が必要。
 * モバイルアプリは別ビルドのため独自フラグ（mobile/config.ts）で切り替える。
 */
export function isBunnyLiveEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BUNNY_LIVE === "true";
}
