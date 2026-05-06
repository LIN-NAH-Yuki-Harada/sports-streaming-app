export type Platform = "ios" | "android" | "other";

export type InAppBrowserInfo = {
  isInApp: boolean;
  platform: Platform;
  appName: string | null;
};

const IN_APP_PATTERNS: Array<[RegExp, string]> = [
  [/Line\//, "LINE"],
  [/Instagram/, "Instagram"],
  [/FBAN|FBAV|FB_IAB/, "Facebook"],
  [/TwitterFor|Twitter for/, "Twitter / X"],
  [/BytedanceWebview|musical_ly/, "TikTok"],
  [/MicroMessenger/, "WeChat"],
  [/KAKAOTALK/i, "KakaoTalk"],
];

export function detectInAppBrowser(ua?: string): InAppBrowserInfo {
  const userAgent =
    ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");

  let appName: string | null = null;
  for (const [pattern, name] of IN_APP_PATTERNS) {
    if (pattern.test(userAgent)) {
      appName = name;
      break;
    }
  }

  const platform: Platform = /iPhone|iPad|iPod/.test(userAgent)
    ? "ios"
    : /Android/.test(userAgent)
      ? "android"
      : "other";

  return {
    isInApp: appName !== null,
    platform,
    appName,
  };
}

export type BroadcastResolution = {
  width: number;
  height: number;
  frameRate: number;
};

// アプリ内ブラウザから外部ブラウザを直接開くための URL を生成。
// iOS は x-safari-https スキーム、Android は intent URI で Chrome を起動する。
export function buildExternalBrowserUrl(currentUrl: string, platform: Platform): string {
  if (platform === "ios") {
    return currentUrl.replace(/^https:\/\//, "x-safari-https://");
  }
  if (platform === "android") {
    try {
      const url = new URL(currentUrl);
      const hostPath = `${url.host}${url.pathname}${url.search}${url.hash}`;
      return `intent://${hostPath}#Intent;scheme=https;package=com.android.chrome;end`;
    } catch {
      return currentUrl;
    }
  }
  return currentUrl;
}

// Canvas 合成配信の解像度。
// 5/06 通信安定性優先で 720p に戻す（5/03 引き上げ → 5/06 引き下げ）。
// 理由:
//  - 1080p は CPU 負荷・発熱・バッテリー消費が 720p の約 2 倍
//  - 夏屋外配信での発熱止まりリスク回避（春の体育館では問題なかったが先回り）
//  - 4G 配信時のアップロード安定性確保（5Mbps → 2.5Mbps）
//  - 古い端末（iPhone X 以前）の HW エンコーダ余裕確保
//  - 「配信が止まらない」を最優先（オーナー判断 5/06）
// 高画質 1080p モードはチームプラン特典として将来 UI トグル化を検討。
export function pickBroadcastResolution(): BroadcastResolution {
  return { width: 1280, height: 720, frameRate: 30 };
}
