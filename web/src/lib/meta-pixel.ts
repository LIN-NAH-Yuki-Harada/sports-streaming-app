// Meta(Facebook/Instagram)広告ピクセル。
// NEXT_PUBLIC_META_PIXEL_ID 未設定なら全関数が no-op = 本番影響ゼロ(フラグOFF出荷)。
// オーナーが Meta でピクセル作成 → Vercel env に ID を設定 → 自動で点灯。
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

type Fbq = (...args: unknown[]) => void;
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export function trackPixel(event: string, params?: Record<string, unknown>) {
  if (!META_PIXEL_ID) return;
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", event, params);
}

// 新規登録(アカウント作成直後)のみ CompleteRegistration を1ブラウザセッションにつき1回発火する。
// 再ログイン(created_at が古い)・既存セッションでは発火しない。
// → 広告の最適化を「登録しやすい人」に寄せ、CPA(登録単価)を下げるための核イベント。
export function trackCompleteRegistrationOnce() {
  if (!META_PIXEL_ID || typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem("spotch_cr_fired") === "1") return;
    window.sessionStorage.setItem("spotch_cr_fired", "1");
  } catch {
    // sessionStorage 不可環境では多重発火を許容(実害小)
  }
  trackPixel("CompleteRegistration");
}
