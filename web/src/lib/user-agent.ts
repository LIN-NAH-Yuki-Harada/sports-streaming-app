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
