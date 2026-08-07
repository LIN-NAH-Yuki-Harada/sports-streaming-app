import { supabase } from "./supabase";

// ============================================================================
// マイページ用のデータ取得ユーティリティ（配信専用ネイティブアプリ）。
//
// Web 版（live-spotch.com）と同じ Supabase バックエンド・同じテーブル/カラムを参照する。
// カラム名・取得列は Web のコードに完全準拠：
//   - profiles の機密列（youtube_*_token / stripe_*）は column-level GRANT で
//     クライアントから遮断されているため、web/src/lib/database.ts の getProfile と
//     同じ「明示列リスト」だけを SELECT する（それ以外を select すると 42501）。
//   - profiles.plan                 : "free" | "broadcaster" | "team"
//   - profiles.display_name         : 表示名（null 可）
//   - profiles.youtube_channel_id   : YouTube 連携済みなら非 null
//   - profiles.youtube_channel_name : 連携先チャンネル名（表示用）
//   - profiles.subscription_status  : Stripe サブスクの状態（表示用）
//
// 連携/解除・プラン変更の「実操作」はアプリ内に置かず Web へ誘導する方針
// （Apple IAP 回避のためアプリ内課金 UI は持たない）。ここは表示専用の取得のみ。
// ============================================================================

/** 配信プラン。profiles.plan の取り得る値（Web と同一）。 */
export type Plan = "free" | "broadcaster" | "team";

/**
 * マイページ表示用のプロフィール最小型。
 * Web の getProfile が返す列のうち、マイページで表示に使うものだけを持つ。
 */
export type MyProfile = {
  id: string;
  display_name: string | null;
  plan: Plan;
  // YouTube 連携（連携済みなら youtube_channel_id が非 null）
  youtube_channel_id: string | null;
  youtube_channel_name: string | null;
  youtube_live_enabled: boolean;
  // Stripe サブスク状態（"active" / "trialing" / "canceled" 等・表示用）
  subscription_status: string | null;
};

// クライアント（anon/authenticated）が SELECT できる列だけを明示指定する。
// web/src/lib/database.ts の getProfile と同一のリストに合わせる（機密列は含めない）。
const PROFILE_PUBLIC_COLUMNS =
  "id, display_name, plan, youtube_channel_id, youtube_channel_name, " +
  "youtube_live_enabled, subscription_status";

// ★ネットワーク待ちの上限（ミリ秒）。
//
// なぜ必要か: lib/supabase.ts の createClient は `db.timeout` を渡しておらず、
// postgrest-js は timeout 未指定なら**素の fetch をそのまま使う**。そして
// React Native の Android 実装（OkHttpClientProvider）は
// `// No timeouts by default` ＝ connect/read/write すべて 0（無制限）。
// つまり「TCP は張れているが応答が返らない」回線（混雑した4G、WiFi→LTE 切替直後、
// 体育館の弱電波）では、**この Promise は永久に settle しない**。
//
// 名前ゲート（NameSetupScreen）はこの Promise の settle を待って画面を解放するので、
// タイムアウトが無いと**全画面ゲートに固着して強制終了しか手が無くなる**。
// リポジトリの既存作法（lib/broadcasts.ts の AbortController + setTimeout）に揃える。
const NETWORK_TIMEOUT_MS = 15_000;

/** profiles の行（明示列 SELECT の結果）を MyProfile に正規化する。 */
function mapProfileRow(data: unknown): MyProfile {
  const row = data as {
    id: string;
    display_name: string | null;
    plan: Plan | null;
    youtube_channel_id: string | null;
    youtube_channel_name: string | null;
    youtube_live_enabled: boolean | null;
    subscription_status: string | null;
  };

  const plan: Plan =
    row.plan === "broadcaster" || row.plan === "team" ? row.plan : "free";

  return {
    id: row.id,
    display_name: row.display_name,
    plan,
    youtube_channel_id: row.youtube_channel_id,
    youtube_channel_name: row.youtube_channel_name,
    youtube_live_enabled: Boolean(row.youtube_live_enabled),
    subscription_status: row.subscription_status,
  };
}

/**
 * 指定ユーザーのプロフィール（マイページ表示用）を取得する。
 * 取得失敗時・タイムアウト時は null を返す。plan が想定外の値なら安全側に "free" 扱い。
 * タイムアウトの理由は下の NETWORK_TIMEOUT_MS のコメントを参照。
 */
export async function fetchMyProfile(userId: string): Promise<MyProfile | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_PUBLIC_COLUMNS)
      .eq("id", userId)
      .abortSignal(ctrl.signal)
      .single();

    if (error || !data) {
      if (error) console.error("プロフィール取得エラー:", error.message);
      return null;
    }

    return mapProfileRow(data);
  } catch (e) {
    console.error("プロフィール取得エラー(例外):", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * 表示名を更新する（Web 版 updateProfile の display_name 限定版）。
 * profiles は機密列が列レベル GRANT で遮断されているため、RETURNING * 相当の
 * .select()（引数なし）は 42501 になる。Web と同じく明示列リストで取得する。
 * 成功時は更新後のプロフィール、失敗時・タイムアウト時は null を返す。
 *
 * ★タイムアウトは「失敗」として null を返す。呼び出し側から見ると通常のエラーと
 *   区別が付かないが、それでよい（どちらもリトライ or 諦めるしか手が無いため）。
 */
export async function updateDisplayName(
  userId: string,
  displayName: string,
): Promise<MyProfile | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", userId)
      .abortSignal(ctrl.signal)
      .select(PROFILE_PUBLIC_COLUMNS)
      .single();

    if (error || !data) {
      if (error) console.error("表示名の更新エラー:", error.message);
      return null;
    }

    return mapProfileRow(data);
  } catch (e) {
    // abort は postgrest 側で握られて error 返却になるはずだが、
    // 経路が変わっても呼び出し側に例外を漏らさない（lib の約束＝throw しない）。
    console.error("表示名の更新エラー(例外):", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** プランの日本語表示ラベル（Web の PLAN_LABELS と一致させる）。 */
export const PLAN_LABELS: Record<Plan, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン（¥300/月）",
  team: "チームプラン（¥500/月）",
};

// iOS 表示用の価格なしラベル（App Store Guideline 3.1.1: アプリ内でデジタル
// サブスクの価格表示＋外部Web決済への誘導はリジェクト要因になりうるため、
// iOS ビルドでは金額を出さない）。Android では PLAN_LABELS を使う。
export const PLAN_LABELS_NO_PRICE: Record<Plan, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン",
  team: "チームプラン",
};
