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

// Canvas 合成配信の解像度を、端末性能に応じて選ぶ。
// 旧 iOS（13 以下）や低コア数端末では 720p にフォールバックして CPU 負荷を抑える。
export function pickBroadcastResolution(): BroadcastResolution {
  if (typeof navigator === "undefined") {
    return { width: 1920, height: 1080, frameRate: 30 };
  }
  const ua = navigator.userAgent;
  const cores = navigator.hardwareConcurrency ?? 4;

  let iosMajor: number | null = null;
  const iosMatch = ua.match(/OS (\d+)[_\.]/);
  if (iosMatch && /iPhone|iPad|iPod/.test(ua)) {
    iosMajor = parseInt(iosMatch[1], 10);
  }

  const lowPower = cores < 4 || (iosMajor !== null && iosMajor < 14);
  if (lowPower) {
    return { width: 1280, height: 720, frameRate: 30 };
  }
  return { width: 1920, height: 1080, frameRate: 30 };
}
