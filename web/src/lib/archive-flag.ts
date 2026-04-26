/**
 * YouTube アーカイブ機能（LiveKit Egress 録画 → YouTube unlisted 自動アップ →
 * 視聴 UI に YouTube 埋め込み表示）全体の ON/OFF スイッチ。
 *
 * Google OAuth 検証センターの審査が通過するまで false 固定で main にマージし続け、
 * 通過後に Vercel Dashboard で true に変更 → Redeploy で本番有効化される。
 *
 * NEXT_PUBLIC_ プレフィックスを付けることで Server Components / API ルート /
 * Client Components いずれからも同じ関数で参照可能。バンドル時に値が固定される
 * ため、値を変えた後は必ず Redeploy が必要。
 */
export function isArchiveEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ARCHIVE_ENABLED === "true";
}
