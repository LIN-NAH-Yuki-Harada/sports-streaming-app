import { requireNativeModule } from "expo";

/** iOS / Android 共通の許可状態。Android は denied を返さない（下の注記参照）。 */
export type DevicePermissionState = "granted" | "denied" | "undetermined";

export type DeviceStatus = {
  camera: DevicePermissionState;
  mic: DevicePermissionState;
};

type NativeModuleShape = {
  getDeviceStatus: () => Promise<DeviceStatus>;
  requestDevicePermissions: () => Promise<DeviceStatus>;
};

// ★requireNativeModule はモジュールが見つからないと**その場で throw する**。
//   import 時に投げると画面ごと落ちるので、必ず遅延取得＋例外を握る。
//   （旧バージョンの JS が新しいネイティブを持たない、という状況は基本起きないが、
//     ここが原因でアプリが起動しない事故だけは絶対に避ける）
let cached: NativeModuleShape | null | undefined;

function nativeModule(): NativeModuleShape | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<NativeModuleShape>("RtmpPublisher");
  } catch {
    cached = null;
  }
  return cached;
}

/** 「わからない」ときの既定値。undetermined＝JS 側は必ず要求しに行く＝安全側。 */
const UNKNOWN: DeviceStatus = { camera: "undetermined", mic: "undetermined" };

function normalize(v: unknown): DeviceStatus {
  const o = (v ?? {}) as Partial<Record<keyof DeviceStatus, string>>;
  const one = (s: string | undefined): DevicePermissionState =>
    s === "granted" || s === "denied" ? s : "undetermined";
  return { camera: one(o.camera), mic: one(o.mic) };
}

/** カメラ／マイクの現在の許可状態を読む（ダイアログは出さない）。 */
export async function getDeviceStatus(): Promise<DeviceStatus> {
  const m = nativeModule();
  if (!m) return UNKNOWN;
  try {
    return normalize(await m.getDeviceStatus());
  } catch {
    return UNKNOWN;
  }
}

/**
 * 未選択（undetermined）のものだけシステムの許可ダイアログを出し、結果を返す。
 *
 * ★iOS 専用の意味を持つ。Android の実際の要求は呼び出し側（BroadcastScreen）の
 *   PermissionsAndroid が行う（Activity が必要なため）。Android でこれを呼んでも
 *   現在値が返るだけで副作用は無い。
 */
export async function requestDevicePermissions(): Promise<DeviceStatus> {
  const m = nativeModule();
  if (!m) return UNKNOWN;
  try {
    return normalize(await m.requestDevicePermissions());
  } catch {
    return UNKNOWN;
  }
}
