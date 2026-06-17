import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

// 広告(Meta/IG)専用の低摩擦ランディング。
// カード不要の無料登録を主役にしてCPA(登録単価)を最小化する。
// 広告専用のため検索インデックスはしない(SEOは /blog 側で別途構築)。
export const metadata: Metadata = {
  title: "子どもの試合を“TV中継風”にライブ配信｜無料ではじめる",
  description:
    "スマホ1台で、子どもの試合をテレビ中継のようにライブ配信。得点や時間を常時表示、送った相手だけが視聴できます。カード不要で無料登録。",
  alternates: { canonical: "/start" },
  robots: { index: false, follow: true },
  openGraph: {
    title: "子どもの試合を“TV中継風”にライブ配信｜LIVE SPOtCH",
    description:
      "スマホ1台で、子どもの試合をテレビ中継のように。得点を常時表示、送った相手だけ視聴。無料ではじめられます。",
    url: "/start",
    type: "website",
  },
};

const POINTS = [
  { t: "スマホ1台でOK", d: "特別な機材も知識もいりません。いつものスマホがそのまま中継カメラに。" },
  { t: "TV中継風スコア表示", d: "得点・時間を映像に常時表示。見ている家族の「今、何点？」をゼロに。" },
  { t: "送った相手だけが視聴", d: "視聴リンクを送った相手だけが観られるから、子どもの試合も安心して共有。" },
  { t: "見る側は登録不要", d: "受け取った家族はリンクをタップするだけ。インストールも会員登録もいりません。" },
];

export default function StartLandingPage() {
  return (
    <div className="px-5 py-8 max-w-md mx-auto">
      {/* ヒーロー */}
      <div className="text-center">
        <p className="inline-block text-xs font-bold text-[#e63946] bg-[#e63946]/10 rounded-full px-3 py-1">
          子ども・地域スポーツのライブ配信
        </p>
        <h1 className="text-2xl font-black leading-tight mt-3">
          子どもの試合が、<br />テレビ中継みたいに。
        </h1>
        <p className="text-sm text-gray-300 mt-3 leading-relaxed">
          スマホ1台で、来られない家族にも“その瞬間”を生中継。
          <br />まずは無料ではじめられます。
        </p>
      </div>

      {/* 価値ポイント */}
      <ul className="mt-6 space-y-2.5">
        {POINTS.map((p) => (
          <li key={p.t} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <span className="text-[#e63946] font-black mt-0.5">✓</span>
            <div>
              <div className="text-sm font-bold">{p.t}</div>
              <div className="text-xs text-gray-400 mt-0.5">{p.d}</div>
            </div>
          </li>
        ))}
      </ul>

      {/* 登録(カード不要・無料) */}
      <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-base font-bold text-center mb-1">無料ではじめる</h2>
        <p className="text-xs text-gray-400 text-center mb-4">
          クレジットカードは不要。Googleまたはメールで登録できます。
        </p>
        <AuthForm defaultMode="signup" redirectTo="/mypage" />
      </div>

      <p className="text-[11px] text-gray-500 text-center mt-5 leading-relaxed">
        ※ プラン・お支払いはWebサイトで管理します。撮影・共有時は周囲やお子さまのプライバシーにご配慮ください。
      </p>
    </div>
  );
}
