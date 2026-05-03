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
// 5/03 配信チェーン全体を 1080p に引き上げ（LiveKit publish / Egress / YouTube ingest を統一）。
// 撮影画質を上げないと YouTube Live ingest 側で 1080p 宣言しても元素材が 720p のため
// アップスケール限界に当たる、という 4/30 朝の実測結果を受けての対応。
// 発熱リスクは：室内体育館（春〜秋の屋内競技）→ 影響小、夏屋外 → 要監視。
// 端末発熱で配信が止まる事案が出たら端末別に 720p フォールバックを検討する。
export function pickBroadcastResolution(): BroadcastResolution {
  return { width: 1920, height: 1080, frameRate: 30 };
}
