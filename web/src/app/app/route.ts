import { detectInAppBrowser } from "@/lib/user-agent";

/**
 * `/app` — 端末に応じて「アプリの入手先」へ振り分ける入口。
 *
 * ■ なぜ作ったか
 * LP のボタンが `/discover`（ブラウザ版）を指しており、**「アプリを開く」と書いてあるのに
 * Web が開く**状態だった。さらに新着バナーのリンク先が Google Play 固定で、
 * **iPhone の利用者がタップすると Google Play が開いていた**（2026-08-28 発見）。
 *
 * 以後「アプリを入手」系のリンクはすべてここへ向ける。貼り間違いが構造的に起きなくなる。
 *
 * ■ 判定
 * iOS → App Store / Android → Google Play / それ以外(PC) → ブラウザ版(/discover)
 * PC でアプリのリンクを踏んだ人を空のストアページに落とさない。
 *
 * ■ ★キャッシュ禁止（ここが一番の落とし穴）
 * 応答が User-Agent で変わるため、CDN に載ると **iPhone 向けの転送が Android の人へ
 * 配られる**。`Cache-Control: no-store` と `Vary: User-Agent` を必ず付ける。
 * このサイトは CloudFront を前段に置いているので、付け忘れると実害が出る。
 */
const APP_STORE_URL = "https://apps.apple.com/jp/app/live-spotch/id6785001863";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.linnah.livespotch";

export async function GET(request: Request): Promise<Response> {
  const ua = request.headers.get("user-agent") ?? "";
  const { platform } = detectInAppBrowser(ua);

  const target =
    platform === "ios"
      ? APP_STORE_URL
      : platform === "android"
        ? PLAY_STORE_URL
        : new URL("/discover", request.url).toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      Vary: "User-Agent",
    },
  });
}
