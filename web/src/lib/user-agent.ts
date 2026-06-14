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

// 生配信（カメラ直 publish）のカメラ要求解像度を、配信開始時の端末の向きに合わせて返す。
//
// 背景: ブラウザ配信で「Android だと横向きが反映されない」というクレーム。原因は電波/画質では
// なく getUserMedia の向きの扱い。iOS Safari は端末の向きに追従して縦横が入れ替わるが、Android
// Chrome は常に横(1280x720)を要求すると向きに追従しにくい。そこで Android のときだけ、配信開始時
// の物理的な向きに合わせて縦横を入れ替えた寸法を要求する。
//
// 安全性:
//  - iOS / PC は従来どおり 1280x720（＝挙動・constraints とも不変、回帰リスクゼロ）。
//  - 値は livekit-client 側で ideal に変換されるため、取得不可なら端末既定にフォールバック
//    （黒画面にならない）。画素数は縦横同じ＝エンコーダ負荷・発熱は不変。
export function pickCameraCaptureResolution(): BroadcastResolution {
  const landscape: BroadcastResolution = { width: 1280, height: 720, frameRate: 30 };
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return landscape;
  }
  if (detectInAppBrowser().platform !== "android") {
    return landscape; // iOS / PC は現状維持
  }
  const isPortrait =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(orientation: portrait)").matches
      : window.innerHeight > window.innerWidth;
  return isPortrait
    ? { width: 720, height: 1280, frameRate: 30 }
    : landscape;
}
