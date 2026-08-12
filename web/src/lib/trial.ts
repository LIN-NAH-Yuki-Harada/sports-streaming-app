/**
 * 無料トライアル（累積10分）の判定ロジック — 単一の正本。
 *
 * これまで「10分」の定義は3箇所に散在していた:
 *   - api/broadcasts/trial-consume の TRIAL_MAX_SECONDS = 600（累積方式・正）
 *   - api/livekit/token の TRIAL_DURATION_MS = 10*60*1000（配信単位方式・誤）
 *   - mobile/lib/plan.ts の FREE_TRIAL_TOTAL_SECONDS = 600（累積方式・正）
 * さらに自前RTMP経路（api/stream/provision）には判定そのものが無く、
 * 「無料プランが課金プランの誰より長く配信できる」状態になっていた。
 * このファイルに集約し、cron / livekit-token が同じ式を見るようにする。
 *
 * ★設計の要: trial_seconds_used は「配信終了時にのみ」加算される（trial-consume）。
 *   ＝配信中はその値がそのまま「この配信を始めた時点の消費量」になる。
 *   したがって配信アプリの trialRemainingAtStart（BroadcastScreen）と必ず一致し、
 *   サーバーは DB の状態だけでクライアントのカウントダウンを完全に再現できる。
 *
 * ★安全側の思想（モバイルとは逆）:
 *   mobile/lib/plan.ts の fetchPlan は取得失敗時に "free" を返す（＝有料扱いしない）。
 *   サーバーで同じ書き方をすると「読めなかった＝全員無料＝一斉カット」になり大事故になる。
 *   ここでは必ず「判定できない → 止めない（false）」に倒す。
 */

/** 無料トライアルの累積上限（秒）= 10分。mobile/lib/plan.ts の FREE_TRIAL_TOTAL_SECONDS と一致。 */
export const TRIAL_MAX_SECONDS = 600;

/** 判定に必要な profiles の列だけを持つ型（cron / token 双方でこの形で SELECT する）。 */
export type TrialProfile = {
  plan: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  trial_seconds_used: number | null;
  updated_at: string | null;
  stripe_subscription_id: string | null;
  iap_original_transaction_id: string | null;
};

/** cron / token が同じ列を SELECT できるようにリテラルを共有する。 */
export const TRIAL_PROFILE_COLUMNS =
  "plan, subscription_status, current_period_end, trial_seconds_used, updated_at, stripe_subscription_id, iap_original_transaction_id";

/**
 * 「解約・失効が確定している」とみなせる subscription_status。
 * これ以外（active / trialing / past_due / 未知の値 / null）は課金中の可能性があるので止めない。
 * ※ past_due は支払い遅延の猶予期間中（RevenueCat BILLING_ISSUE でも入る）。試合を止めてよい状態ではない。
 */
const SETTLED_INACTIVE_STATUSES = new Set(["expired", "canceled", "cancelled"]);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

/** 現在の課金痕跡（Stripe / IAP のサブスクID）があれば絶対に止めない。既定 ON。 */
export function skipEverPaid(): boolean {
  return envBool("TRIAL_ENFORCE_SKIP_EVER_PAID", true);
}

/**
 * プラン反映待ちの猶予（ミリ秒）。既定10分。
 *
 * ★ profiles.updated_at の実態に注意:
 *   - Web のプロフィール更新（database.ts updateProfile）は updated_at を書く。
 *   - Stripe / RevenueCat の webhook は書いていなかったため、実質「アカウント作成時刻」だった。
 *     → 本PRで両 webhook にも updated_at のスタンプを追加し、「最後にプランが動いた時刻」に揃えた。
 *   - 過去に作られた行の updated_at は作成時刻のまま。その場合この猶予は
 *     「登録直後（＝購入直後の可能性が最も高い瞬間）は切らない」として機能する。
 *   いずれの解釈でも安全側にしか働かない。
 */
export function planSettleMs(): number {
  return envInt("TRIAL_ENFORCE_PLAN_SETTLE_MS", 10 * 60 * 1000);
}

/** cron のジッタ・端末とサーバーの時計ずれを吸収する猶予（秒）。既定120秒。 */
export function enforceGraceSeconds(): number {
  return envInt("TRIAL_ENFORCE_GRACE_SEC", 120);
}

/** 1 tick で切ってよい上限。超えたら「判定が壊れている」とみなし1本も切らない。既定3。 */
export function enforceMaxPerTick(): number {
  return envInt("TRIAL_ENFORCE_MAX_PER_TICK", 3);
}

/** off = 何もしない（既定） / dry = 対象を数えるだけ / on = 実際に止める。 */
export type TrialEnforceMode = "off" | "dry" | "on";

export function trialEnforceMode(): TrialEnforceMode {
  const raw = process.env.TRIAL_ENFORCE_MODE?.trim().toLowerCase();
  if (raw === "on" || raw === "dry") return raw;
  return "off"; // 未設定・未知の値は必ず off（安全側）
}

/** 残りトライアル秒。プロフィールが読めない場合は「使い切っていない」とみなす。 */
export function remainingSeconds(profile: TrialProfile | null | undefined): number {
  if (!profile) return TRIAL_MAX_SECONDS;
  const used = Number(profile.trial_seconds_used ?? 0);
  if (!Number.isFinite(used) || used <= 0) return TRIAL_MAX_SECONDS;
  return Math.max(0, TRIAL_MAX_SECONDS - Math.floor(used));
}

/**
 * 「この人の配信を10分で止めてよいか」の門番。
 *
 * ★迷ったら必ず false（＝止めない）。課金者を free と誤判定して試合を止めるのが最悪の事故。
 * 逆に false 側に倒しすぎて無料ユーザーを取り逃しても、失うのは月数百円であって信頼ではない。
 */
export function isEnforceableFree(
  profile: TrialProfile | null | undefined,
  nowMs: number,
): boolean {
  // 1. そもそも読めなかった（Supabase の一時5xx・行が無い等）→ 止めない
  if (!profile) return false;

  // 2. free 以外（broadcaster / team / null / 未知の値）→ 止めない
  if (profile.plan !== "free") return false;

  // 3. 解約・失効が確定していない限り止めない（active / trialing / past_due / 未知は課金中扱い）
  //    ※ 初月無料クーポン(SPOT)経由のユーザーが plan='free' + status='trialing' で
  //      運用されている可能性があるため、ここで確実に救う。
  if (
    profile.subscription_status &&
    !SETTLED_INACTIVE_STATUSES.has(profile.subscription_status.toLowerCase())
  ) {
    return false;
  }

  // 4. 課金期間が残っている（解約済みでも期末までは有料）→ 止めない
  if (profile.current_period_end) {
    const end = Date.parse(profile.current_period_end);
    if (Number.isFinite(end) && end > nowMs) return false;
  }

  // 5. 現在の課金痕跡（Stripe サブスクID / Apple original_transaction_id）があれば止めない。
  //    本プロダクトでは「課金は通ったのに plan が free のまま」が実際に複数回起きている
  //    （IAP webhook の列欠落 / 匿名購入で RC の紐付けが外れる 等）。その取りこぼしを拾う。
  //    ※ 失効時は webhook 側でこれらの列が null に戻されるため、
  //      「一度でも課金した人を永久に免除する」ことにはならない。
  if (
    skipEverPaid() &&
    (profile.stripe_subscription_id || profile.iap_original_transaction_id)
  ) {
    return false;
  }

  // 6. プラン反映待ちの猶予（購入直後に webhook がまだ来ていない窓）→ 止めない
  const updatedAt = profile.updated_at ? Date.parse(profile.updated_at) : NaN;
  if (!Number.isFinite(updatedAt)) return false; // 時刻が読めない＝鮮度を検証できない → 止めない
  if (nowMs - updatedAt < planSettleMs()) return false;

  return true;
}

/**
 * 配信を打ち切ってよいか（経過時間まで含めた最終判定）。
 * 式はアプリのカウントダウン（BroadcastScreen: trialRemainingAtStart - elapsed <= 0）と同一で、
 * cron のジッタと時計ずれの分だけ GRACE を足して「クライアントより先に切らない」ようにする。
 */
export function shouldCutBroadcast(params: {
  profile: TrialProfile | null | undefined;
  startedAt: string | null | undefined;
  nowMs: number;
}): boolean {
  const { profile, startedAt, nowMs } = params;
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return false;
  if (!isEnforceableFree(profile, nowMs)) return false;
  const elapsedSec = (nowMs - started) / 1000;
  if (elapsedSec < 0) return false; // 未来日時＝データ異常 → 触らない
  return elapsedSec >= remainingSeconds(profile) + enforceGraceSeconds();
}
