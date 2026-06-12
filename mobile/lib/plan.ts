import { supabase } from "./supabase";
import { SITE_URL } from "../config";

// ============================================================================
// 配信プラン関連のユーティリティ（モバイル配信アプリ用）
//
// Web 版（live-spotch.com）と同じ Supabase バックエンド・Next.js API を叩く。
// カラム名・リクエスト形状は Web のコードに完全準拠：
//   - profiles.plan                : "free" | "broadcaster" | "team"
//     （web/src/lib/database.ts / api/livekit/token / api/broadcasts/trial-consume）
//   - profiles.trial_seconds_used  : 累積トライアル消費秒（web/src/lib/database.ts）
//   - 無料トライアル上限 = 600 秒（10 分）
//     （api/broadcasts/trial-consume の TRIAL_MAX_SECONDS=600 /
//      api/livekit/token の TRIAL_DURATION_MS=10*60*1000 / 料金ページ「初回10分間は無料」）
//   - POST /api/broadcasts/trial-consume body = { seconds: number, broadcastId?: string }
// ============================================================================

/** 配信プラン。profiles.plan の取り得る値（Web と同一）。 */
export type Plan = "free" | "broadcaster" | "team";

/**
 * 無料トライアルの累積上限（秒）= 10 分。
 * Web の api/broadcasts/trial-consume の TRIAL_MAX_SECONDS と一致させる。
 */
export const FREE_TRIAL_TOTAL_SECONDS = 600;

/**
 * 指定ユーザーの現在のプランを取得する。
 * Web と同じく profiles テーブルの plan カラムを読む。
 * 取得失敗時は安全側に倒して "free" を返す（誤って有料扱いしない）。
 */
export async function fetchPlan(userId: string): Promise<Plan> {
  const { data, error } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  if (error || !data) {
    if (error) console.error("プラン取得エラー:", error.message);
    return "free";
  }

  const plan = (data as { plan: Plan | null }).plan;
  // 想定外の値が来た場合も安全側に "free" 扱い。
  return plan === "broadcaster" || plan === "team" ? plan : "free";
}

/**
 * 指定ユーザーの累積トライアル消費秒を取得する。
 * Web と同じく profiles.trial_seconds_used を読む。
 * 値が null / 未設定 / 取得失敗の場合は 0 を返す。
 */
export async function fetchTrialUsedSeconds(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("profiles")
    .select("trial_seconds_used")
    .eq("id", userId)
    .single();

  if (error || !data) {
    if (error) console.error("トライアル消費秒の取得エラー:", error.message);
    return 0;
  }

  const used = Number((data as { trial_seconds_used: number | null }).trial_seconds_used ?? 0);
  return Number.isFinite(used) && used > 0 ? used : 0;
}

/**
 * 配信終了時に、消費したトライアル秒数をサーバーに加算する。
 *
 * Web の POST /api/broadcasts/trial-consume を叩く。
 * - 認証は Authorization: Bearer <accessToken>（getUser がこのヘッダから検証する）。
 * - body は { seconds, broadcastId? }。broadcastId を渡すとサーバーが
 *   broadcasts.started_at から実経過時間を算出してクライアント報告と min を取り、
 *   改ざん（0 秒で 600 秒消費 等）を防ぐ。可能なら呼び出し側で渡すこと。
 *
 * サーバー側で 600 秒上限・有料ユーザー除外・PER_REQUEST_CAP クランプを行うため、
 * このクライアント関数では加算ロジックを持たず、計測した秒数をそのまま送るだけにする。
 *
 * @param accessToken Supabase セッションの access_token
 * @param seconds     クライアントが計測した今回の配信経過秒数
 * @param broadcastId 対象 broadcasts.id（任意・改ざん耐性のため推奨）
 */
export async function consumeTrial(
  accessToken: string,
  seconds: number,
  broadcastId?: string
): Promise<void> {
  // 負値・非有限値はサーバーが 400 を返すため、ここで弾いて無駄な往復を避ける。
  if (!Number.isFinite(seconds) || seconds <= 0) return;

  const body: { seconds: number; broadcastId?: string } = {
    seconds: Math.floor(seconds),
  };
  if (broadcastId && broadcastId.length > 0) {
    body.broadcastId = broadcastId;
  }

  const res = await fetch(`${SITE_URL}/api/broadcasts/trial-consume`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // 終了処理の付随処理なので throw はせず、ログのみ（配信終了 UX を阻害しない）。
    const text = await res.text().catch(() => "");
    console.error(`トライアル消費の記録に失敗 (HTTP ${res.status}):`, text);
  }
}
