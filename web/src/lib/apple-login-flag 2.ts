/**
 * Web版の「Appleでサインイン」ボタンの表示フラグ（既定 OFF）
 *
 * 【なぜフラグが要るか】
 *   Supabase 側の Apple 設定（Services ID / Secret Key）が入るまでボタンを出すと、
 *   押した人は Supabase の英語の生 JSON エラーに飛ばされ、戻る手段が無い。
 *   supabase-js の signInWithOAuth は URL を組んで即ページ遷移するだけで、
 *   設定不備をブラウザ側で捕まえられない（常に error:null を返す）ため
 *   try/catch では防げない。**設定の完了を人間が確認してから点灯する**しかない。
 *
 * 【点灯手順】
 *   Vercel の環境変数に NEXT_PUBLIC_APPLE_LOGIN_ENABLED=true を追加して再デプロイ。
 *   消したいときは値を消す（または false）だけで、コードは触らない。
 *
 * 【なぜ必要な機能か】
 *   iOSアプリは「Appleでサインイン」を提供しており（App Store ガイドライン 4.8）、
 *   Apple の「メールを非公開」は @privaterelay.appleid.com を発行する。
 *   Web に Apple が無いと、同じ人が Google でログインしても**別アカウント**になり、
 *   アプリで購入したチームプランが Web で反映されない。
 *   2026-08-14 実測: アプリ内課金 4名のうち 2名（=半数）がこの行き止まりに入っていた。
 *   YouTube 連携は Web でしかできないため、課金の目的そのものに到達できない。
 */
export function isAppleLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_APPLE_LOGIN_ENABLED === "true";
}
