"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/logo";
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

  // URL クエリ `?promo=XXX` で届いたら初期値にセット（営業 DM 直リンク用）
  useEffect(() => {
    const queryPromo = searchParams.get("promo");
    if (queryPromo && !promoInput) {
      setPromoInput(queryPromo.trim().toUpperCase());
    }
    // promoInput が変わる度に発火させたくないので依存は searchParams のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const currentPlan = profile?.plan ?? "free";

  async function verifyPromo() {
    const normalized = promoInput.trim().toUpperCase();
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

  const handleSubscribe = async (plan: "broadcaster" | "team") => {
    if (!user) {
      router.push("/");
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
        {/* ヒーロー */}
        <div className="mb-10 md:mb-12">
          <p className="text-[#e63946] text-sm font-medium tracking-wide mb-2">Pricing</p>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight">
            プランを選んで、<br className="md:hidden" />配信を始めよう。
          </h2>
          <p className="mt-3 text-sm md:text-base text-gray-500 leading-relaxed">
            いつでも解約できます。初回10分間は無料でお試しいただけます。
          </p>
        </div>

        {/* 現在のプラン表示 */}
        {!authLoading && user && (
          <div className="mb-6 rounded-lg bg-[#111] border border-white/5 px-4 py-3">
            <p className="text-xs text-gray-500">現在のプラン</p>
            <p className="text-sm font-semibold mt-0.5">{PLAN_LABELS[currentPlan as Plan]}</p>
          </div>
        )}

        {/* クーポンコード入力（営業配布・無料トライアル用） */}
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
                if (promoInput.trim() && promoState.status === "idle") verifyPromo();
              }}
              className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-[#e63946]/50 focus:outline-none transition tracking-widest"
              maxLength={32}
              autoCapitalize="characters"
              spellCheck={false}
              aria-label="クーポンコード"
            />
            <button
              type="button"
              onClick={verifyPromo}
              disabled={promoState.status === "checking" || !promoInput.trim()}
              className="shrink-0 px-4 py-2 rounded-md text-sm font-semibold transition bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {promoState.status === "checking" ? "確認中..." : "確認"}
            </button>
          </div>

          {promoState.status === "valid" && (
            <div className="mt-3 flex items-start gap-2 text-xs text-[#34d399]">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>
                <strong>{promoState.code}</strong> で{" "}
                <strong>{promoState.trialDays}日間の無料トライアル</strong>{" "}
                が適用されます。この下のプランに加入ボタンを押すと、トライアル期間は課金されません。
              </span>
            </div>
          )}

          {promoState.status === "invalid" && (
            <div className="mt-3 flex items-start gap-2 text-xs text-[#e63946]">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 9l-6 6M9 9l6 6" />
              </svg>
              <span>{promoState.error}</span>
            </div>
          )}

          {promoState.status === "idle" && (
            <p className="mt-2 text-[11px] text-gray-600">
              コードがない場合はそのままプランを選んで加入いただけます。初月からの通常課金になります。
            </p>
          )}
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-4 rounded-md bg-[#e63946]/10 border border-[#e63946]/30 px-4 py-3 text-sm text-[#e63946]">
            {error}
          </div>
        )}

        {/* プランカード */}
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
          <div className="rounded-lg border border-[#e63946]/40 bg-[#e63946]/5 p-5 md:p-6 relative flex flex-col">
            <span className="absolute -top-2 right-4 bg-[#e63946] text-white text-[10px] font-bold px-2 py-0.5 rounded">
              人気
            </span>
            <p className="text-xs text-[#e63946] mb-1">配信者プラン</p>
            <p className="text-2xl font-black">
              ¥300<span className="text-sm font-normal text-gray-400">/月</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">保護者・コーチ向け</p>
            <ul className="mt-3 space-y-1.5 text-[11px] md:text-xs text-gray-400 flex-1">
              <li>✓ ライブ配信</li>
              <li>✓ スコアボード・オーバーレイ</li>
              <li>✓ リモコンでスコア操作</li>
              <li>✓ 限定公開の共有コード</li>
              <li>✓ アーカイブ自動保存</li>
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
                {loadingPlan === "broadcaster" ? "処理中..." : "このプランに加入"}
              </button>
            )}
          </div>

          {/* チームプラン */}
          <div className="rounded-lg border border-white/20 bg-white/5 p-5 md:p-6 flex flex-col">
            <p className="text-xs text-white mb-1">チームプラン</p>
            <p className="text-2xl font-black">
              ¥500<span className="text-sm font-normal text-gray-400">/月</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">チーム代表・コーチ向け</p>
            <ul className="mt-3 space-y-1.5 text-[11px] md:text-xs text-gray-400 flex-1">
              <li>✓ 配信者プランの全機能</li>
              <li>✓ 大容量アーカイブストレージ</li>
              <li>✓ スケジュール管理</li>
              <li>✓ メンバー管理・自動共有</li>
              <li className="text-gray-500">✓ YouTube自動アーカイブ（近日公開）</li>
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
                {loadingPlan === "team" ? "処理中..." : "このプランに加入"}
              </button>
            )}
          </div>
        </div>

        {/* 注意事項 */}
        <div className="mt-10 rounded-lg bg-[#111] border border-white/5 p-5 text-xs text-gray-500 leading-relaxed space-y-2">
          <p className="font-semibold text-gray-400">ご利用にあたっての注意</p>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>決済は Stripe を通じて安全に処理されます。カード情報は当社では一切保持しません。</li>
            <li>解約はマイページまたは「プラン管理」からいつでも可能です。</li>
            <li>解約後も当該月末までは引き続きご利用いただけます。</li>
            <li>現在はテスト環境のため、テスト用カード番号でのみ決済可能です。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
