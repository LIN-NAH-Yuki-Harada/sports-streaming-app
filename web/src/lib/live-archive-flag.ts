/**
 * Live 中継移行（YouTube Live RTMP push）機能全体の ON/OFF スイッチ。
 *
 * - false: 旧パイプライン（LiveKit Egress S3 録画 → cron → YouTube アップロード）稼働
 * - true:  新パイプライン（LiveKit Egress RTMP push → YouTube Live → 自動アーカイブ）稼働
 *
 * profile.youtube_live_enabled との AND 条件で個別 broadcaster ごとの有効化を制御する
 * （PR-4 以降で broadcast/page.tsx に組み込む）。
 *
 * NEXT_PUBLIC_ プレフィックスを付けることで Server Components / API ルート /
 * Client Components いずれからも同じ関数で参照可能。バンドル時に値が固定される
 * ため、値を変えた後は必ず Redeploy が必要。
 *
 * PR-1（DB + flag）マージ時点では false 固定で main にマージし続け、
 * PR-2〜5 完了 + テスト OK 後に Vercel Dashboard で true に切替 → Redeploy で本番有効化される。
 */
export function isLiveArchiveEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LIVE_ARCHIVE === "true";
}
