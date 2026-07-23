import { Platform } from "react-native";
import Purchases from "react-native-purchases";

// ============================================================================
// RevenueCat（アプリ内課金 / IAP）初期化ヘルパー
//
// 課金は RevenueCat 経由で App Store の自動更新サブスクを扱う。
// 購入が成立すると RevenueCat → サーバー webhook（/api/revenuecat/webhook）が
// profiles.plan を更新し、アプリは fetchPlan() で plan を読むだけ（権威ソースは Supabase）。
//
// app_user_id を Supabase の user.id に合わせる（logIn）ことで、webhook 側で
// event.app_user_id = profiles.id の対応付けができる。
//
// iOS / Android 両対応。購入は RevenueCat 経由で App Store / Google Play の
// 自動更新サブスクを扱う。Platform ごとに公開 SDK キーを選択する。
// ============================================================================

// RevenueCat の公開 SDK キー（公開用＝アプリ埋め込み前提。秘密ではない）。
const RC_IOS_API_KEY = "appl_bFDLNtFvDCcBbkdWpJgzRhRZBGU";
// ⚠️ Android キー：RevenueCat に Android アプリを追加後に発行される goog_… キーに
//    差し替えること（未設定のままだと Android の課金が動かない）。
const RC_ANDROID_API_KEY = "goog_OMpiVyfStvcLSyJXmpcsxGkwFiK";

// RevenueCat が使えるプラットフォームか（iOS / Android）。
export const RC_SUPPORTED =
  Platform.OS === "ios" || Platform.OS === "android";

// 実行中プラットフォームの公開キーを選ぶ。
const RC_API_KEY =
  Platform.OS === "android" ? RC_ANDROID_API_KEY : RC_IOS_API_KEY;

let configured = false;

/** RevenueCat SDK を一度だけ初期化する。複数回呼んでも安全。 */
export function configureRevenueCat(): void {
  if (configured || !RC_SUPPORTED) return;
  try {
    Purchases.configure({ apiKey: RC_API_KEY });
    configured = true;
  } catch {
    // 初期化失敗時も購入以外の機能は動かす（plan は Supabase 読み取りのため）。
  }
}

/** Supabase ユーザーID で RevenueCat にログイン（webhook の app_user_id と一致させる）。 */
export async function rcLogIn(userId: string): Promise<void> {
  if (!RC_SUPPORTED || !userId) return;
  configureRevenueCat();
  try {
    await Purchases.logIn(userId);
  } catch {
    /* 失敗してもアプリは続行（購入時に再ログインされる） */
  }
}

/** ログアウト時に RevenueCat も匿名に戻す（別ユーザーの購入が紐づかないように）。 */
export async function rcLogOut(): Promise<void> {
  if (!RC_SUPPORTED) return;
  try {
    await Purchases.logOut();
  } catch {
    /* 既に匿名等で失敗しても無視 */
  }
}

/**
 * 購入 / 復元の直前に必ず呼ぶ。RevenueCat を Supabase user.id で logIn させ、
 * 現在の app_user_id が実 userId に一致（＝匿名 $RCAnonymousID でない）ことを保証する。
 * これに失敗したまま購入すると購入が匿名IDに紐づき、webhook が profiles.plan を更新できず
 * 「課金したのに反映されない」状態になる（起動時の fire-and-forget logIn 取りこぼし対策）。
 *
 * 判定は必ず「現在の app_user_id」＝ getAppUserID() を権威にする。logIn は app_user_id を
 * ローカルで先に切替えてからバックエンド同期するため、弱回線で同期だけ reject/タイムアウトしても
 * ローカルが userId に切替わっていれば購入は userId に正しく紐づく（＝誤ってブロックしない）。
 * ※ customerInfo.originalAppUserId は匿名→logIn でエイリアスした端末では $RCAnonymousID が
 *   残るため判定に使ってはいけない（使うと全ユーザーが購入不能になる）。
 *
 * @returns 現在の app_user_id が userId に一致していれば true（false のときは購入を止めること）
 */
export async function ensureRcIdentity(userId: string): Promise<boolean> {
  if (!RC_SUPPORTED || !userId) return false;
  configureRevenueCat();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 弱回線/圏外で logIn のバックエンド同期がハングしても購入UIを固めないよう 8 秒で区切る。
    await Promise.race([
      Purchases.logIn(userId),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("rc-login-timeout")), 8000);
      }),
    ]);
  } catch {
    /* 同期失敗/タイムアウトは無視。判定は下の「現在の app_user_id」に委ねる。 */
  } finally {
    if (timer) clearTimeout(timer);
  }
  return (await Purchases.getAppUserID().catch(() => null)) === userId;
}
