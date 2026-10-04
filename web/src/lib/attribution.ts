// 登録経路（どこから来て会員登録したか）の記録。
//
// 仕組み:
//   1. 初めてサイトに来たとき、URL の utm_* / 着地ページ / 参照元を localStorage に1回だけ保存（first-touch）
//   2. 新規登録の直後に auth-provider がそれを /api/attribution に送り、profiles.signup_* に書く
//
// 着地ページが /watch/<コード> なら「誰かの配信を見に来て登録した」＝視聴→登録の導線（LOOP A）。
// LINE のアプリ内ブラウザは参照元を送らないことが多いので、共有リンク側に utm を付けて補う（withUtm）。

const STORAGE_KEY = "ls_first_touch";
// これより古い記録は「別の訪問」とみなして上書きする
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type FirstTouch = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  landing_path: string;
  referrer_host?: string;
  at: string;
};

function clip(v: string | null | undefined, max = 100): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function read(): FirstTouch | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as FirstTouch;
    if (!v?.at || Date.now() - new Date(v.at).getTime() > MAX_AGE_MS) return null;
    return v;
  } catch {
    return null;
  }
}

/** 初回訪問の情報を保存する（既に有効な記録があれば何もしない）。 */
export function captureFirstTouch(): void {
  if (typeof window === "undefined") return;
  if (read()) return;
  try {
    const url = new URL(window.location.href);
    let referrerHost: string | undefined;
    try {
      const h = document.referrer ? new URL(document.referrer).hostname : "";
      // 自サイト内の遷移は参照元として数えない
      if (h && h !== window.location.hostname) referrerHost = clip(h);
    } catch {
      // 不正な referrer は無視
    }
    const touch: FirstTouch = {
      utm_source: clip(url.searchParams.get("utm_source")),
      utm_medium: clip(url.searchParams.get("utm_medium")),
      utm_campaign: clip(url.searchParams.get("utm_campaign")),
      landing_path: clip(url.pathname, 200) ?? "/",
      referrer_host: referrerHost,
      at: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(touch));
  } catch {
    // localStorage が使えない環境（プライベートモード等）は記録しない
  }
}

export function getFirstTouch(): FirstTouch | null {
  if (typeof window === "undefined") return null;
  return read();
}

/** 共有・説明文に載せる URL に utm を付ける（既に付いていれば触らない）。 */
export function withUtm(url: string, source: string, medium: string, campaign?: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("utm_source")) return url;
    u.searchParams.set("utm_source", source);
    u.searchParams.set("utm_medium", medium);
    if (campaign) u.searchParams.set("utm_campaign", campaign);
    return u.toString();
  } catch {
    return url;
  }
}
