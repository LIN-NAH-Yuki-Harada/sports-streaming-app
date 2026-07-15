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
