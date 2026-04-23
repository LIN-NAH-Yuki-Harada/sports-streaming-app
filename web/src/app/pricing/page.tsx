"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
import { AuthForm } from "@/components/auth-form";
import { createClient } from "@/lib/supabase";

type Plan = "free" | "broadcaster" | "team";

const PLAN_LABELS: Record<Plan, string> = {
  free: "無料プラン",
  broadcaster: "配信者プラン",
  team: "チームプラン",
};

type PromoState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid"; code: string; trialDays: number }
  | { status: "invalid"; error: string };

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="px-5 py-10 text-sm text-gray-500">読み込み中...</div>}>
      <PricingPageInner />
    </Suspense>
  );
}

function PricingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, loading: authLoading } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // プロモコード関連
  const [promoInput, setPromoInput] = useState("");
  const [promoState, setPromoState] = useState<PromoState>({ status: "idle" });

  // ログイン誘導セクションへのスクロール用
  const authSectionRef = useRef<HTMLDivElement | null>(null);

  async function runValidate(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setPromoState({ status: "idle" });
      return;
    }
    setPromoState({ status: "checking" });
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const data = await res.json();
      if (data.valid) {
        setPromoState({
          status: "valid",
          code: normalized,
          trialDays: data.trial_days,
        });
      } else {
        setPromoState({
          status: "invalid",
          error: data.error ?? "このコードは利用できません",
        });
      }
    } catch {
      setPromoState({
        status: "invalid",
        error: "通信エラーが発生しました",
      });
    }
  }

  // URL クエリ `?promo=XXX` で届いたら、自動で入力欄にセットして即検証する（営業 DM 直リンク用）
  useEffect(() => {
    const queryPromo = searchParams.get("promo");
    if (queryPromo) {
      const normalized = queryPromo.trim().toUpperCase();
      setPromoInput(normalized);
      runValidate(normalized);
    }
    // promoInput が変わる度に発火させたくないので依存は searchParams のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const currentPlan = profile?.plan ?? "free";
  const hasValidPromo = promoState.status === "valid";
  // 未ログインかつ有効コード → 先にアカウント作成が必要なので強調する
  const mustLoginFirst = hasValidPromo && !user && !authLoading;
  // ログイン後に現在プラン（このページの URL）に戻る
  const loginReturnUrl = hasValidPromo
    ? `/pricing?promo=${encodeURIComponent(promoState.code)}`
    : "/pricing";

  const handleSubscribe = async (plan: "broadcaster" | "team") => {
    if (!user) {
      // 未ログイン → ページ内のログインセクションへ誘導（従来は `/` に飛ばしていた）
      setError("プラン加入にはアカウントが必要です。下のフォームからアカウント作成／ログインしてください。");
      authSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setLoadingPlan(plan);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("セッションが無効です。再ログインしてください。");
        setLoadingPlan(null);
        return;
      }
      const checkoutBody: { plan: "broadcaster" | "team"; promoCode?: string } = { plan };
      if (promoState.status === "valid") {
        checkoutBody.promoCode = promoState.code;
      }
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(checkoutBody),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "決済ページの準備に失敗しました");
        setLoadingPlan(null);
        return;
      }
      // Stripe Checkout へリダイレクト
      window.location.href = data.url;
    } catch (e) {
      console.error(e);
      setError("通信エラーが発生しました");
      setLoadingPlan(null);
    }
  };

  const handleManage = async () => {
    if (!user) return;
    setLoadingPlan(currentPlan as Plan);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "カスタマーポータルを開けませんでした");
        setLoadingPlan(null);
      }
    } catch {
      setError("通信エラーが発生しました");
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen">
      {/* ヘッダー */}
      <header className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 py-3 border-b border-white/5">
        <div className="flex items-center justify-between gap-3">
          <Logo />
          <button
            onClick={() => router.back()}
            className="text-xs text-gray-400 hover:text-white transition"
            aria-label="戻る"
          >
            ← 戻る
          </button>
        </div>
        <h1 className="mt-2 text-sm font-bold text-gray-400">料金プラン</h1>
      </header>

      <div className="px-5 md:px-8 lg:px-10 pt-8 md:pt-12 pb-24">
        {/* ── 有効なプロモコードがある場合の "クーポン誘導" ヒーロー ─────────────────── */}
        {hasValidPromo ? (
          <div className="mb-8 rounded-2xl border border-[#e63946]/40 bg-gradient-to-br from-[#e63946]/20 via-[#e63946]/5 to-transparent p-6 md:p-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 bg-[#e63946] text-white text-[10px] font-black px-2 py-0.5 rounded tracking-widest">
                COUPON
              </span>
              <span className="text-[11px] text-[#e63946] font-semibold">
                {promoState.code} 適用中
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight">
              {promoState.trialDays}日間 完全無料で、
              <br className="md:hidden" />
              配信を始めよう。
            </h2>
            <p className="mt-3 text-sm md:text-base text-gray-300 leading-relaxed">
              このページから登録すると、
              <strong className="text-white">最初の {promoState.trialDays} 日間は料金が発生しません</strong>
              。カード情報だけ登録しておけば、{promoState.trialDays + 1} 日目から
              通常料金（¥300/月 or ¥500/月）での利用が自動開始します。
              <br />
              続けない場合はマイページからいつでも 1 タップで解約でき、解約後もトライアル期間中は使い続けられます。
            </p>

            {/* ステップインジケータ */}
            <ol className="mt-5 grid grid-cols-3 gap-2 text-[11px] sm:text-xs">
              <li
                className={`rounded-md px-3 py-2 border ${
                  user
                    ? "border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399]"
                    : "border-[#e63946]/40 bg-[#e63946]/10 text-[#e63946] font-semibold"
                }`}
              >
                <span className="font-black mr-1">①</span>
                {user ? "ログイン済み ✓" : "アカウント作成/ログイン"}
              </li>
              <li
                className={`rounded-md px-3 py-2 border ${
                  user
                    ? "border-[#e63946]/40 bg-[#e63946]/10 text-[#e63946] font-semibold"
                    : "border-white/10 bg-white/5 text-gray-500"
                }`}
              >
                <span className="font-black mr-1">②</span>
                プランを選ぶ
              </li>
              <li className="rounded-md px-3 py-2 border border-white/10 bg-white/5 text-gray-500">
                <span className="font-black mr-1">③</span>
                カード登録で開始
              </li>
            </ol>
          </div>
        ) : promoState.status === "invalid" ? (
          <div className="mb-8 rounded-lg border border-[#e63946]/30 bg-[#e63946]/10 px-4 py-3 text-sm text-[#e63946]">
            クーポンコード「{promoInput}」は現在利用できません: {promoState.error}
            <span className="block mt-1 text-xs text-gray-400">
              通常料金のプランはこの下から選べます。
            </span>
          </div>
        ) : (
          // プロモコードなしの通常ヒーロー
          <div className="mb-10 md:mb-12">
            <p className="text-[#e63946] text-sm font-medium tracking-wide mb-2">Pricing</p>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight">
              プランを選んで、<br className="md:hidden" />配信を始めよう。
            </h2>
            <p className="mt-3 text-sm md:text-base text-gray-500 leading-relaxed">
              いつでも解約できます。初回10分間は無料でお試しいただけます。
            </p>
          </div>
        )}

        {/* 現在のプラン表示 */}
        {!authLoading && user && (
          <div className="mb-6 rounded-lg bg-[#111] border border-white/5 px-4 py-3">
            <p className="text-xs text-gray-500">現在のプラン</p>
            <p className="text-sm font-semibold mt-0.5">{PLAN_LABELS[currentPlan as Plan]}</p>
          </div>
        )}

        {/* ── 未ログイン + 有効クーポン → インラインでアカウント作成/ログイン ──── */}
        {mustLoginFirst && (
          <div
            ref={authSectionRef}
            className="mb-8 rounded-xl bg-[#111] border border-[#e63946]/30 p-5 md:p-6"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#e63946] text-white text-xs font-black">1</span>
              <h3 className="text-sm md:text-base font-bold">
                まずアカウントを作成 or ログインしてください
              </h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              無料トライアルの適用にはユーザー登録が必要です。
              <strong className="text-white">Google でログインが最速</strong>
              （30秒で完了）。ログイン後、自動でこのページに戻り、② のプラン選択に進めます。
            </p>
            <AuthForm redirectTo={loginReturnUrl} />
          </div>
        )}

        {/* エラー表示 */}
        {error && (
          <div className="mb-4 rounded-md bg-[#e63946]/10 border border-[#e63946]/30 px-4 py-3 text-sm text-[#e63946]">
            {error}
          </div>
        )}

        {/* ── クーポンコード入力（手動入力用・営業 DM 未経由の人向け） ──────────── */}
        {!hasValidPromo && (
          <div className="mb-6 rounded-lg bg-[#111] border border-white/5 px-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-[#e63946] tracking-widest">COUPON</span>
              <span className="text-xs text-gray-400">
                無料トライアルコードをお持ちの方
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="例: SPOT1W"
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value.toUpperCase());
                  if (promoState.status !== "idle") setPromoState({ status: "idle" });
                }}
                onBlur={() => {
                  if (promoInput.trim() && promoState.status === "idle") runValidate(promoInput);
                }}
                className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition tracking-widest"
                maxLength={32}
                autoCapitalize="characters"
                spellCheck={false}
                aria-label="クーポンコード"
              />
              <button
                type="button"
                onClick={() => runValidate(promoInput)}
                disabled={promoState.status === "checking" || !promoInput.trim()}
                className="shrink-0 px-4 py-2 rounded-md text-sm font-semibold transition bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {promoState.status === "checking" ? "確認中..." : "確認"}
              </button>
            </div>
            {promoState.status === "idle" && (
              <p className="mt-2 text-[11px] text-gray-600">
                コードがない場合はそのままプランを選んで加入いただけます。通常料金でのお申し込みになります。
              </p>
            )}
            {promoState.status === "checking" && (
              <p className="mt-2 text-[11px] text-gray-500">確認中です...</p>
            )}
          </div>
        )}

        {/* ── プランカード ─────────────────────────────────────────────────── */}
        <div className="grid gap-4 md:gap-6 md:grid-cols-3">
          {/* 無料プラン */}
          <div className="rounded-lg border border-white/10 p-5 md:p-6 flex flex-col">
            <p className="text-xs text-gray-500 mb-1">視聴する人</p>
            <p className="text-2xl font-black">無料</p>
            <p className="text-xs text-gray-500 mt-3 leading-relaxed">
              共有コードで配信・アーカイブを視聴。
            </p>
            <ul className="mt-3 space-y-1.5 text-[11px] md:text-xs text-gray-500 flex-1">
              <li>✓ ライブ視聴</li>
              <li>✓ 1ヶ月以内のアーカイブ視聴</li>
            </ul>
            <button
              disabled
              className="mt-5 w-full rounded-md bg-white/5 text-gray-500 text-xs font-semibold py-2.5 cursor-not-allowed"
            >
              {currentPlan === "free" ? "利用中" : "登録のみで利用可"}
            </button>
          </div>

          {/* 配信者プラン */}
          <div
            className={`rounded-lg border p-5 md:p-6 relative flex flex-col ${
              hasValidPromo
                ? "border-[#e63946] bg-[#e63946]/10 shadow-lg shadow-[#e63946]/10"
                : "border-[#e63946]/40 bg-[#e63946]/5"
            }`}
          >
            <span className="absolute -top-2 right-4 bg-[#e63946] text-white text-[10px] font-bold px-2 py-0.5 rounded">
              {hasValidPromo ? `${promoState.trialDays}日無料` : "人気"}
            </span>
            <p className="text-xs text-[#e63946] mb-1">配信者プラン</p>
            <p className="text-2xl font-black">
              ¥300<span className="text-sm font-normal text-gray-400">/月</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">個人保護者向け・ライブ専用</p>
            <ul className="mt-3 space-y-1.5 text-[11px] md:text-xs text-gray-400 flex-1">
              <li>✓ 無制限ライブ配信</li>
              <li>✓ スコアボード・オーバーレイ（手動入力）</li>
              <li>✓ 限定公開の共有コード発行</li>
              <li>✓ LINE ワンタップ共有</li>
              <li className="text-gray-500">※ アーカイブ保存はチームプラン限定</li>
            </ul>
            {currentPlan === "broadcaster" ? (
              <button
                onClick={handleManage}
                disabled={loadingPlan !== null}
                className="mt-5 w-full rounded-md bg-white/10 hover:bg-white/15 text-white text-xs font-semibold py-2.5 transition disabled:opacity-50"
              >
                {loadingPlan === "broadcaster" ? "読み込み中..." : "プラン管理"}
              </button>
            ) : (
              <button
                onClick={() => handleSubscribe("broadcaster")}
                disabled={loadingPlan !== null || authLoading}
                className="mt-5 w-full rounded-md bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold py-2.5 transition disabled:opacity-50"
              >
                {loadingPlan === "broadcaster"
                  ? "処理中..."
                  : hasValidPromo
                    ? `${promoState.trialDays}日間無料で始める`
                    : "このプランに加入"}
              </button>
            )}
            {hasValidPromo && currentPlan !== "broadcaster" && (
              <p className="mt-2 text-[10px] text-gray-500 text-center">
                今日は ¥0 / {promoState.trialDays + 1}日目から ¥300/月
              </p>
            )}
          </div>

          {/* チームプラン */}
          <div
            className={`rounded-lg border p-5 md:p-6 flex flex-col ${
              hasValidPromo
                ? "border-white/40 bg-white/10"
                : "border-white/20 bg-white/5"
            }`}
          >
            <p className="text-xs text-white mb-1">チームプラン</p>
            <p className="text-2xl font-black">
              ¥500<span className="text-sm font-normal text-gray-400">/月</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">チーム代表・コーチ向け・記録運用</p>
            <ul className="mt-3 space-y-1.5 text-[11px] md:text-xs text-gray-400 flex-1">
              <li>✓ 配信者プランの全機能</li>
              <li>✓ チーム作成・メンバー招待</li>
              <li>✓ 試合スケジュール管理</li>
              <li>✓ 共有コードのチーム自動配布</li>
              <li className="text-gray-500">🔜 リモコンでスコア操作（別端末から）</li>
              <li className="text-gray-500">🔜 アーカイブ自動保存（1ヶ月視聴可）</li>
              <li className="text-gray-500">🔜 YouTube 自動アーカイブ（長期保存）</li>
              <li className="text-gray-500">🔜 AI ハイライト自動生成</li>
            </ul>
            {currentPlan === "team" ? (
              <button
                onClick={handleManage}
                disabled={loadingPlan !== null}
                className="mt-5 w-full rounded-md bg-white/10 hover:bg-white/15 text-white text-xs font-semibold py-2.5 transition disabled:opacity-50"
              >
                {loadingPlan === "team" ? "読み込み中..." : "プラン管理"}
              </button>
            ) : (
              <button
                onClick={() => handleSubscribe("team")}
                disabled={loadingPlan !== null || authLoading}
                className="mt-5 w-full rounded-md bg-white hover:bg-gray-200 text-black text-xs font-semibold py-2.5 transition disabled:opacity-50"
              >
                {loadingPlan === "team"
                  ? "処理中..."
                  : hasValidPromo
                    ? `${promoState.trialDays}日間無料で始める`
                    : "このプランに加入"}
              </button>
            )}
            {hasValidPromo && currentPlan !== "team" && (
              <p className="mt-2 text-[10px] text-gray-500 text-center">
                今日は ¥0 / {promoState.trialDays + 1}日目から ¥500/月
              </p>
            )}
          </div>
        </div>

        {/* 注意事項 */}
        <div className="mt-10 rounded-lg bg-[#111] border border-white/5 p-5 text-xs text-gray-500 leading-relaxed space-y-2">
          <p className="font-semibold text-gray-400">ご利用にあたっての注意</p>
          <ul className="space-y-1.5 list-disc list-inside">
            {hasValidPromo && (
              <li className="text-gray-300">
                無料トライアル期間は <strong className="text-white">{promoState.trialDays} 日間</strong>。
                期間終了後は自動で通常料金が発生します。続けない場合はマイページから 1 タップで解約してください（解約後もトライアル終了日まで引き続きご利用可能）。
              </li>
            )}
            <li>決済は Stripe を通じて安全に処理されます。カード情報は当社では一切保持しません。</li>
            <li>解約はマイページまたは「プラン管理」からいつでも可能です。</li>
            <li>解約後も当該月末までは引き続きご利用いただけます。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
