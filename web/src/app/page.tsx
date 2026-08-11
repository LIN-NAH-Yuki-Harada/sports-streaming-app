import type { Metadata } from "next";
import Image from "next/image";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com";

// iOS アプリ（App Store 公開中・2026-07-09 リリース）
const APP_STORE_URL = "https://apps.apple.com/jp/app/live-spotch/id6785001863";

// Android アプリ（Google Play 公開中）
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.linnah.livespotch";

const FAQ_ITEMS = [
  {
    q: "子どもの顔が映るのが心配です。大丈夫ですか？",
    a: "共有コードを知る人だけが視聴できる限定公開なので、ご家族・チーム関係者以外には配信は届きません。アーカイブは配信者ご自身のYouTubeチャンネルに「限定公開」で保存され、リンクを知る人だけが視聴できます。",
  },
  {
    q: "配信の画質はどれくらいですか？",
    a: "HD画質（720p）で配信しています。一般的なLTE回線・WiFi環境で安定して視聴できます。",
  },
  {
    q: "10分の無料お試し時間が終わったらどうなりますか？",
    a: "無料お試しは複数回の配信合計で10分間までです。使い切ったあとも、配信者プラン（¥300/月）にご登録いただければすぐに配信を続けられます。いつでも解約できます。",
  },
  {
    q: "配信者プランとチームプランの違いは？",
    a: "配信者プラン（¥300/月）は個人保護者向けの「ライブ配信専用プラン」です。自社プレイヤーで試合をリアルタイムに家族へ届ける用途に最適（アーカイブ保存はありません）。チームプラン（¥500/月）は記録運用向けで、自社プレイヤー配信に加えて YouTube Live 同時配信・YouTube への自動アーカイブ・チーム管理・スケジュール管理・リモコン操作（開発中）・AIハイライト（開発中）が追加されます。",
  },
  {
    q: "複数の家族・親戚が同時に視聴できますか？",
    a: "人数制限はありません。共有コードさえお持ちなら、何人でも同時に視聴いただけます。",
  },
  {
    q: "視聴する側も料金はかかりますか？",
    a: "視聴は完全無料で、アカウント登録も不要です。共有コードのリンクを受け取ったら、開くだけですぐに観戦できます。",
  },
  {
    q: "アプリのダウンロードは必要ですか？",
    a: "不要です。Webブラウザからそのまま使えます。より安定して配信したい方には、iOS / Android アプリを App Store / Google Play で配信中です。視聴する側はアプリ不要で、リンクを開くだけで観戦できます。",
  },
  {
    q: "解約はかんたんにできますか？",
    a: "マイページの「プラン管理」からいつでも解約できます。解約後も当該月末まではご利用可能です。",
  },
  {
    q: "サッカー・野球・バスケ以外のスポーツにも対応していますか？",
    a: "はい。バレーボール・陸上・テニス・卓球・水泳・ラグビー・ハンドボールなど、すべてのスポーツに対応しています。スポーツ少年団・部活・地域リーグ問わずご利用いただけます。",
  },
  {
    q: "遠方の祖父母や親戚にも試合を見せられますか？",
    a: "共有コードを LINE 等で送るだけで、遠方のご家族・親戚も試合をリアルタイムで観戦できます。登録不要なので、シニア世代でもリンクを開くだけで観戦できます。",
  },
];

const LP_TITLE =
  "子どもの試合をスマホでライブ配信｜スポーツ少年団・部活・地域大会対応";
const LP_DESCRIPTION =
  "スポーツ少年団・中学部活・高校部活・ジュニアの試合を、保護者のスマホ1台でライブ配信。スコアボード常時表示・限定公開で安心。サッカー・野球・バスケ・バレー・陸上などあらゆるスポーツ対応。初月無料クーポン『SPOT』配布中。";

export const metadata: Metadata = {
  title: LP_TITLE,
  description: LP_DESCRIPTION,
  keywords: [
    "スポーツ ライブ配信",
    "子ども 試合 配信",
    "スポーツ少年団 ライブ配信",
    "部活 試合 配信",
    "ジュニア スポーツ 配信",
    "スマホ スポーツ配信",
    "スコアボード オーバーレイ",
    "保護者 試合 観戦",
    "地域大会 配信",
    "サッカー ライブ配信",
    "バレー ライブ配信",
    "野球 ライブ配信",
    "バスケ ライブ配信",
    "限定公開 試合配信",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    title: `${LP_TITLE} | LIVE SPOtCH`,
    description: LP_DESCRIPTION,
    url: "/",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${LP_TITLE} | LIVE SPOtCH`,
    description: LP_DESCRIPTION,
  },
};

const FAQ_JSONLD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: {
      "@type": "Answer",
      text: a,
    },
  })),
};

const SOFTWARE_APP_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "LIVE SPOtCH",
  applicationCategory: "SportsApplication",
  operatingSystem: "Web, iOS, Android",
  installUrl: [APP_STORE_URL, PLAY_STORE_URL],
  description:
    "保護者のスマホ1台でスポーツ少年団・部活・地域大会の試合をライブ配信。スコアボード・限定公開に対応したUGC型スポーツライブ配信プラットフォーム。アプリはApp Store / Google Playで配信中。",
  url: `${SITE_URL}/`,
  image: `${SITE_URL}/opengraph-image.jpg`,
  offers: [
    {
      "@type": "Offer",
      name: "視聴プラン（無料）",
      price: "0",
      priceCurrency: "JPY",
      description:
        "共有コードでライブ視聴（登録不要）。チームプラン配信はYouTubeアーカイブも視聴可。",
    },
    {
      "@type": "Offer",
      name: "配信者プラン（月額）",
      price: "300",
      priceCurrency: "JPY",
      description:
        "無制限ライブ配信・スコアボード・LINE共有・限定公開の共有コード（月額¥300）",
    },
    {
      "@type": "Offer",
      name: "チームプラン（月額）",
      price: "500",
      priceCurrency: "JPY",
      description:
        "配信者プランの全機能 + YouTube Live 同時配信（ベータ公開中） + YouTube 自動アーカイブ（ベータ公開中） + チーム・スケジュール管理（月額¥500）",
    },
  ],
  featureList: [
    "HDスコアボード常時オーバーレイ表示",
    "スマホ1台でライブ配信",
    "共有コードによる限定公開",
    "LINE ワンタップ共有",
    "サッカー・野球・バスケ・バレー・陸上など全スポーツ対応",
    "スポーツ少年団・部活・地域大会向け",
  ],
};

/** セクション見出しの共通キッカー（赤ライン＋ラベル） */
function SectionKicker({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-[#e63946] text-[11px] sm:text-xs font-bold tracking-[0.18em] mb-3">
      <span className="h-px w-6 bg-[#e63946]/70" aria-hidden="true" />
      {label}
    </p>
  );
}

/** デモスコアボードのカウントアップ桁（0→3 / 0→1、CSSのみ） */
function ScoreDigit({ digits, track }: { digits: string[]; track: string }) {
  return (
    <span className="inline-block h-[1.2em] overflow-hidden align-bottom">
      <span className={`${track} flex flex-col`}>
        {digits.map((d) => (
          <span key={d} className="h-[1.2em] leading-[1.2em] font-black tabular-nums">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function LandingPage() {
  return (
    <div>
      {/* LP専用ヘッダー */}
      <header
        className="sticky top-0 z-50 bg-[#0a0a0a]/85 backdrop-blur-md border-b border-white/5"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8 py-3">
          <a href="/" className="flex items-center gap-2">
            <span className="bg-[#e63946] text-white text-xs font-black px-1.5 py-0.5 rounded tracking-wider">
              LIVE
            </span>
            <span className="text-base font-bold tracking-tight">LIVE SPOtCH</span>
          </a>
          {/* PC用ナビ */}
          <div className="hidden sm:flex items-center gap-6 text-[13px]">
            <a href="#features" className="text-gray-400 hover:text-white transition">特徴</a>
            <a href="#how" className="text-gray-400 hover:text-white transition">使い方</a>
            <a href="#pricing" className="text-gray-400 hover:text-white transition">料金</a>
            <a
              href="/discover"
              className="bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-4 py-1.5 rounded-full transition shadow-lg shadow-[#e63946]/20"
            >
              アプリを開く
            </a>
          </div>
          {/* スマホ用ボタン */}
          <a
            href="/discover"
            className="sm:hidden bg-[#e63946] hover:bg-[#d62836] text-white text-xs font-semibold px-3 py-1.5 rounded-full transition"
          >
            アプリを開く
          </a>
        </nav>
      </header>

      {/* NEW リリースバナー: Android アプリ Google Play 配信開始（iOSと両対応に） */}
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-gradient-to-r from-[#e63946]/90 via-[#d62836] to-[#e63946]/90 text-white text-center text-[11px] sm:text-xs py-2 px-4 hover:from-[#e63946] hover:to-[#e63946] transition group"
      >
        <span className="inline-flex items-center gap-2 font-semibold">
          <span className="bg-white text-[#e63946] text-[9px] font-black px-1.5 py-0.5 rounded">NEW</span>
          <span>📱 Android版アプリが登場！App Store / Google Play で配信中</span>
          <span className="hidden sm:inline opacity-70 group-hover:opacity-100 transition">→ ダウンロード</span>
        </span>
      </a>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* グリッド背景（radialマスクで中央に集光） */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_35%,black,transparent)]" />
        {/* 複層グロー */}
        <div className="lp-glow-breathe absolute -top-24 left-1/2 -translate-x-1/2 w-[320px] sm:w-[680px] h-[320px] sm:h-[440px] bg-[#e63946]/15 rounded-full blur-[120px]" />
        <div className="absolute top-40 -left-24 w-[260px] h-[260px] bg-[#e63946]/[0.07] rounded-full blur-[100px]" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 lg:pt-28 pb-16 sm:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <p className="text-[#e63946] text-xs sm:text-sm font-semibold tracking-wide mb-3 sm:mb-4">
                誰もがスポーツ中継のカメラマン。手元のスマホが機材になる。
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.12] tracking-tight text-balance bg-gradient-to-b from-white via-white to-white/70 bg-clip-text text-transparent pb-1">
                子どもの試合を、
                <br />
                どこにいても見届ける。
              </h1>
              <p className="mt-5 sm:mt-7 text-gray-300 text-sm sm:text-base max-w-lg leading-relaxed">
                <strong className="text-white">スポーツ少年団・中学部活・高校部活・ジュニアスポーツ</strong>の試合を、
                保護者のスマホ1台でライブ配信。
                サッカー・野球・バスケ・バレー・陸上など、あらゆるローカル試合をテレビ中継品質でお届けします。
              </p>
              <p className="mt-2.5 text-gray-500 text-xs sm:text-sm max-w-lg leading-relaxed">
                共有コードひとつで、チームの関係者だけがリアルタイム観戦。地域大会・練習試合・公式戦など、メディアが来ない試合こそ家族に届けたい瞬間を残せます。
              </p>

              {/* 安心感バッジ */}
              <div className="mt-6 sm:mt-7 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 bg-white/[0.04] ring-1 ring-white/10 rounded-full px-3 py-1 text-[11px] text-gray-300">
                  <span aria-hidden="true">🔒</span> 限定公開なので安心
                </span>
                <span className="inline-flex items-center gap-1.5 bg-white/[0.04] ring-1 ring-white/10 rounded-full px-3 py-1 text-[11px] text-gray-300">
                  <span aria-hidden="true">📱</span> スマホ1台でOK
                </span>
                <span className="inline-flex items-center gap-1.5 bg-white/[0.04] ring-1 ring-white/10 rounded-full px-3 py-1 text-[11px] text-gray-300">
                  <span aria-hidden="true">📺</span> TV中継品質のスコアボード
                </span>
                <span className="inline-flex items-center gap-1.5 bg-[#e63946]/10 ring-1 ring-[#e63946]/30 rounded-full px-3 py-1 text-[11px] text-white">
                  <span aria-hidden="true">📡</span> YouTube Live 同時配信
                  <span className="bg-[#e63946] text-white text-[8px] font-black px-1 py-0.5 rounded ml-0.5">NEW</span>
                </span>
              </div>

              <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <a
                  href="/broadcast"
                  className="bg-[#e63946] hover:bg-[#d62836] text-white text-sm sm:text-base font-bold px-7 py-3.5 rounded-full transition w-full sm:w-auto text-center shadow-xl shadow-[#e63946]/25 hover:shadow-[#e63946]/40 hover:-translate-y-0.5 duration-300"
                >
                  まずは10分間、無料で試す
                </a>
                <span className="text-sm text-gray-600 px-2 sm:px-4 py-1 sm:py-3">
                  Webブラウザで今すぐ使えます
                </span>
              </div>

              {/* iOS / Android アプリ（App Store / Google Play 公開中）。バッジは各社公式アセット（self-host・無改変） */}
              {/* Google Play バッジ PNG は余白込みアセット（可視部は高さの約77%）のため、可視高さが App Store バッジと揃うよう h を大きめに指定 */}
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block hover:opacity-80 transition"
                  aria-label="App Store で LIVE SPOtCH をダウンロード"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/appstore-badge-ja.svg"
                    alt="App Store でダウンロード"
                    width={136}
                    height={50}
                    className="h-[44px] w-auto"
                  />
                </a>
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block hover:opacity-80 transition"
                  aria-label="Google Play で LIVE SPOtCH をダウンロード"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/google-play-badge-ja.png"
                    alt="Google Play で手に入れよう"
                    width={147}
                    height={57}
                    className="h-[57px] w-auto"
                  />
                </a>
                <span className="text-[11px] text-gray-600 leading-relaxed">
                  iOS / Android
                  <br />
                  アプリ配信中
                </span>
              </div>
            </div>

            {/* 配信画面プレビュー（実写映像 + CSSオーバーレイ / スコアはカウントアップ演出） */}
            <div className="relative mx-auto w-full max-w-sm lg:max-w-none aspect-[9/16] lg:aspect-[4/5] max-h-[420px] sm:max-h-[500px] rounded-3xl overflow-hidden ring-1 ring-white/15 shadow-2xl shadow-black/60" aria-hidden="true">
              <Image
                src="/lp-hero-soccer.jpg"
                alt="スポーツ少年団のサッカーの試合をスマホでライブ配信する保護者"
                fill
                sizes="(max-width: 1024px) 384px, 500px"
                className="object-cover object-center"
                priority
              />
              {/* UI 視認性確保のための薄い暗幕 */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/50" />
              {/* 左上: スコアボード（0→3 / 0→1 カウントアップ） */}
              <div className="absolute top-3 left-3 flex items-center bg-black/70 backdrop-blur-sm rounded-md overflow-hidden text-[10px] shadow-lg">
                <div className="px-2 py-1 bg-white/10 font-bold">港FC</div>
                <div className="flex items-center gap-0.5 px-3 py-1 bg-[#e63946]">
                  <ScoreDigit digits={["0", "1", "2", "3"]} track="lp-score-home-track" />
                  <span className="text-[8px] text-white/60">-</span>
                  <ScoreDigit digits={["0", "1"]} track="lp-score-away-track" />
                </div>
                <div className="px-2 py-1 bg-white/10 font-bold">南FC</div>
                <div className="px-2 py-1 bg-black/60">
                  <span className="tabular-nums">前半</span>
                </div>
              </div>
              {/* 右上: LIVE（パルスリング） */}
              <div className="lp-live-glow absolute top-3 right-3 flex items-center gap-1 bg-[#e63946] px-2 py-1 rounded text-[9px] font-bold">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                </span>
                LIVE
              </div>
              {/* 上部中央: 視聴者数 */}
              <div className="absolute top-14 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
                <span className="text-[9px] text-gray-300 font-medium">👀 12人が視聴中</span>
              </div>
              {/* 左下: 共有コード */}
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded px-2.5 py-1.5">
                <span className="text-[8px] text-gray-400">コード</span>
                <span className="text-[10px] font-black tracking-widest">A8C3</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 使い方：3ステップ */}
      <section id="how" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <SectionKicker label="使い方" />
        <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12">スマホ1台でライブ配信する3ステップ</h2>
        <div className="grid gap-4 sm:gap-6 lg:gap-8 grid-cols-1 sm:grid-cols-3">
          {[
            { step: "STEP 1", title: "無料登録してすぐ配信", desc: "メールアドレスで無料登録。チーム名を入れたら、合計10分間まで無料で配信を試せます。", image: "/lp-hero-soccer.jpg", alt: "スマホで少年サッカーの試合を撮影・ライブ配信する保護者" },
            { step: "STEP 2", title: "共有コードをLINEで送る", desc: "配信が始まると共有コードを自動発行。チームのLINEグループに送るだけ。", image: "/lp-steps-line-share.jpg", alt: "試合のライブ配信コードをLINEで家族・チーム関係者に共有する様子" },
            { step: "STEP 3", title: "家族がどこからでも無料で観戦", desc: "コードを受け取った人はリンクを開くだけ。登録不要・視聴は完全無料。スコアボード付きのTV中継品質。", image: "/lp-steps-family-watch.jpg", alt: "遠方の家族がスマホで子どもの試合をリアルタイム観戦" },
          ].map((item) => (
            <div key={item.step} className="group rounded-2xl bg-white/[0.03] ring-1 ring-white/10 overflow-hidden hover:ring-[#e63946]/40 hover:-translate-y-1 transition duration-300">
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <Image src={item.image} alt={item.alt} fill className="object-cover group-hover:scale-[1.03] transition duration-500" sizes="(max-width: 640px) 100vw, 33vw" />
              </div>
              <div className="p-5 sm:p-6">
                <span className="text-[#e63946] text-xs font-black tracking-widest">{item.step}</span>
                <h3 className="text-sm sm:text-base font-semibold mt-2 mb-1.5">{item.title}</h3>
                <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 対応スポーツ */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-14 sm:py-20 border-t border-white/5">
        <h2 className="text-sm sm:text-base font-semibold text-gray-300 mb-5 sm:mb-7">
          対応スポーツ — サッカー・野球・バスケ・バレー・陸上など全ジャンル
        </h2>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {[
            { emoji: "⚽", name: "サッカー" },
            { emoji: "⚾", name: "野球" },
            { emoji: "🏀", name: "バスケ" },
            { emoji: "🏐", name: "バレー" },
            { emoji: "🏃", name: "陸上" },
            { emoji: "🎾", name: "テニス" },
            { emoji: "🏓", name: "卓球" },
            { emoji: "🏊", name: "水泳" },
            { emoji: "🏉", name: "ラグビー" },
            { emoji: "🤾", name: "ハンドボール" },
          ].map((s) => (
            <span key={s.name} className="text-xs sm:text-sm text-gray-300 bg-white/[0.04] ring-1 ring-white/10 hover:ring-[#e63946]/30 hover:text-white transition px-3 sm:px-4 py-1.5 sm:py-2 rounded-full">
              {s.emoji} {s.name}
            </span>
          ))}
          <span className="text-xs sm:text-sm text-gray-600 px-3 sm:px-4 py-1.5 sm:py-2">...その他すべてのスポーツ</span>
        </div>
      </section>

      {/* 特徴 */}
      <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-white/5">
        <SectionKicker label="特徴" />
        <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12">YouTubeライブにはない、試合配信に特化した4つの機能</h2>
        <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
          {[
            { headline: "スマホ1台", sub: "機材不要", desc: "プロ機材なしでスマホ1台。手軽にライブ配信。" },
            { headline: "TV品質", sub: "スコアボード常時表示", desc: "チーム名、スコア、時間をオーバーレイ。映像を遮ることなく試合情報が届く。" },
            { headline: "限定公開", sub: "プライバシーを守る", desc: "共有コードを持つ人だけが視聴可能。お子さまの映像が不特定多数に公開されません。" },
            { headline: "視聴無料", sub: "家族は登録不要でタダ", desc: "見る人は完全無料・登録不要。コードを受け取ったらすぐに観戦できます。" },
          ].map((f) => (
            <div key={f.headline} className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 hover:ring-[#e63946]/40 hover:-translate-y-1 transition duration-300 p-5 sm:p-6">
              <p className="text-[#e63946] text-xl sm:text-2xl font-black mb-2 tracking-tight">{f.headline}</p>
              <p className="text-xs sm:text-sm font-medium mb-1.5">{f.sub}</p>
              <p className="text-[11px] sm:text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* こんなときに使えます */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-white/5">
        <SectionKicker label="利用シーン" />
        <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12">こんな場面で使える、試合ライブ配信</h2>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
          {[
            { title: "試合に行けない日に", desc: "仕事で応援に行けなくても、スマホでリアルタイム観戦。お子さまの活躍を見逃しません。", image: "/lp-scenes-office-dad.jpg", alt: "仕事中の父親がオフィスからスマホで子どもの試合をライブ観戦" },
            { title: "おじいちゃん、おばあちゃんに", desc: "遠方に住む祖父母にもコードを送るだけ。孫の試合を一緒に応援。", image: "/lp-scenes-grandparents.jpg", alt: "離れた地域の祖父母がタブレットで孫の試合を観戦" },
            { title: "チームの振り返りに", desc: "チームプランのアーカイブ自動保存で、試合後の反省会や戦術確認に。コーチも選手も使えます。", image: "/lp-scenes-coach-review.jpg", alt: "スポーツ少年団のコーチが試合アーカイブで戦術を振り返る様子" },
            { title: "大会・講演会の中継に", desc: "スポーツに限らず、学校行事や講演会の限定配信にも対応。", image: "/lp-scenes-school-event.jpg", alt: "学校行事や地域大会をライブ配信して関係者に届ける様子" },
          ].map((item) => (
            <div key={item.title} className="group rounded-2xl ring-1 ring-white/10 overflow-hidden bg-white/[0.02] hover:ring-[#e63946]/40 hover:-translate-y-1 transition duration-300">
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <Image src={item.image} alt={item.alt} fill className="object-cover group-hover:scale-[1.03] transition duration-500" sizes="(max-width: 640px) 100vw, 50vw" />
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold mb-1">{item.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* こんなチームに使われています */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-white/5">
        <SectionKicker label="選ばれる理由" />
        <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-10">スポーツ少年団・部活・地域リーグに選ばれています</h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {[
            { title: "⚽ スポーツ少年団", desc: "地域の大会・練習試合を保護者がスマホで配信。試合に来れない家族もリアルタイムで応援。", image: "/lp-hero-soccer.jpg", alt: "スポーツ少年団の地域大会をスマホでライブ配信する保護者" },
            { title: "🏐 中学校・高校の部活", desc: "公式戦の模様をOB/OGや保護者に限定配信。スコアボードで試合展開も一目瞭然。", image: "/lp-teams-junior-volleyball.jpg", alt: "中学校・高校のバレー部の公式戦をライブ配信" },
            { title: "🏆 地域リーグ・ローカル大会", desc: "メディアが来ない地域の試合も、チーム関係者だけのプライベート中継で盛り上がる。", image: "/lp-teams-local-adult.jpg", alt: "地域リーグ・ローカル大会の試合をスマホで配信" },
          ].map((item) => (
            <div key={item.title} className="group relative rounded-2xl ring-1 ring-white/10 hover:ring-[#e63946]/40 transition duration-300 overflow-hidden aspect-[4/3]">
              <Image src={item.image} alt={item.alt} fill className="object-cover group-hover:scale-[1.03] transition duration-500" sizes="(max-width: 640px) 100vw, 33vw" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/20" />
              <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
                <p className="text-sm font-semibold mb-1">{item.title}</p>
                <p className="text-xs text-gray-200 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 保護者の声 */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-white/5">
        <SectionKicker label="利用者の声" />
        <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12">保護者・コーチの声</h2>
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-3">
          {[
            {
              voice: "「土曜の大会、祖父母にも見せられて本当に嬉しかった。シニア世代にも簡単に使えるのが◎」",
              name: "小学生サッカーの保護者",
              role: "スポーツ少年団",
            },
            {
              voice: "「スコアボードが映るだけで、見ている側の熱量が全然違う。応援LINEがこれまでの倍来るようになった」",
              name: "中学バレー部コーチ",
              role: "部活動",
            },
            {
              voice: "「試合に来られない遠方の親戚にも、その場の空気を届けられる。『行った気になれる』のがいい」",
              name: "保護者会メンバー",
              role: "地域リーグ",
            },
          ].map((v, i) => (
            <div key={i} className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-5 sm:p-6">
              <div className="text-[#e63946] text-2xl leading-none mb-3 font-serif" aria-hidden="true">“</div>
              <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">{v.voice}</p>
              <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-[11px] font-semibold text-gray-400">{v.name}</p>
                <p className="text-[10px] text-gray-600 mt-0.5">{v.role}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[10px] text-gray-600 text-center">
          ※ 想定される利用シーンの声です。実際のユーザーの声は随時掲載予定です。
        </p>
      </section>

      {/* 料金 */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-white/5">
        <SectionKicker label="料金" />
        <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12">シンプルな料金プラン</h2>
        <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-3 max-w-4xl mx-auto items-start">
          <div className="rounded-2xl ring-1 ring-white/10 bg-white/[0.02] p-5 sm:p-6">
            <p className="text-xs text-gray-500 mb-1">視聴する人</p>
            <p className="text-2xl sm:text-3xl font-black">無料</p>
            <p className="text-xs text-gray-500 mt-3 leading-relaxed">
              共有コードでライブ視聴。登録不要。チームプラン配信はYouTubeアーカイブも視聴可。
            </p>
            <ul className="mt-4 space-y-2 text-[11px] sm:text-xs text-gray-400">
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> ライブ視聴（登録不要）</li>
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> アーカイブ視聴（チームプラン配信のYouTube限定公開）</li>
            </ul>
          </div>
          <div className="rounded-2xl ring-1 ring-white/10 bg-white/[0.02] p-5 sm:p-6">
            <p className="text-xs text-gray-400 mb-1">配信者プラン</p>
            <p className="text-2xl sm:text-3xl font-black">¥300<span className="text-sm font-normal text-gray-400">/月</span></p>
            <p className="text-xs text-gray-400 mt-1">個人保護者向け・ライブ専用</p>
            <ul className="mt-4 space-y-2 text-[11px] sm:text-xs text-gray-400">
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> 無制限ライブ配信</li>
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> スコアボード・オーバーレイ</li>
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> LINE共有（ワンタップ）</li>
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> 限定公開の共有コード</li>
              <li className="text-gray-600">※ アーカイブ保存はチームプラン限定</li>
            </ul>
          </div>
          <div className="relative rounded-2xl ring-2 ring-[#e63946]/60 bg-gradient-to-b from-[#e63946]/10 to-white/[0.02] p-5 sm:p-6 shadow-xl shadow-[#e63946]/10">
            <span className="absolute -top-2.5 left-5 bg-[#e63946] text-white text-[10px] font-black px-2.5 py-0.5 rounded-full tracking-wider">人気</span>
            <p className="text-xs text-[#e63946] font-semibold mb-1">チームプラン</p>
            <p className="text-2xl sm:text-3xl font-black">¥500<span className="text-sm font-normal text-gray-400">/月</span></p>
            <p className="text-xs text-gray-400 mt-1">チーム代表・コーチ向け・記録運用</p>
            <ul className="mt-4 space-y-2 text-[11px] sm:text-xs text-gray-300">
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> 配信者プランの全機能</li>
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> チーム作成・メンバー招待</li>
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> 試合スケジュール管理</li>
              <li className="flex gap-1.5"><span className="text-[#e63946]">✓</span> 共有コードのチーム自動配布</li>
              <li className="flex items-center gap-1.5 flex-wrap text-white">
                <span className="flex gap-1.5"><span className="text-[#e63946]">✓</span> YouTube Live 同時配信（リアルタイム拡散）</span>
                <span className="bg-[#e63946] text-white text-[8px] font-black px-1.5 py-0.5 rounded">ベータ</span>
              </li>
              <li className="flex items-center gap-1.5 flex-wrap text-white">
                <span className="flex gap-1.5"><span className="text-[#e63946]">✓</span> YouTube に自動アーカイブ（長期保存）</span>
                <span className="bg-[#e63946] text-white text-[8px] font-black px-1.5 py-0.5 rounded">ベータ</span>
              </li>
              <li className="text-gray-500">🔜 リモコンでスコア操作（別端末から）</li>
              <li className="text-gray-500">🔜 AI ハイライト自動生成</li>
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-white/5">
        <SectionKicker label="FAQ" />
        <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12">スポーツライブ配信のよくある質問</h2>
        <div className="space-y-3">
          {FAQ_ITEMS.map((faq, i) => (
            <details
              key={i}
              className="group rounded-xl bg-white/[0.03] ring-1 ring-white/10 open:ring-[#e63946]/30 transition"
            >
              <summary className="flex items-center justify-between gap-4 cursor-pointer px-4 sm:px-5 py-3.5 sm:py-4 list-none">
                <span className="text-xs sm:text-sm font-semibold text-gray-200">{faq.q}</span>
                <span
                  className="text-xs text-gray-500 transition-transform duration-300 group-open:rotate-180"
                  aria-hidden="true"
                >
                  ▼
                </span>
              </summary>
              <div className="px-4 sm:px-5 pb-4 text-xs sm:text-sm text-gray-400 leading-relaxed">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-white/5">
        <div className="absolute inset-0">
          <Image
            src="/lp-cta-emotional.jpg"
            alt="試合の感動を家族と共有するイメージ"
            fill
            className="object-cover object-[25%_30%]"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/30" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-24 sm:py-32 lg:py-36">
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight tracking-tight drop-shadow-lg text-balance">
              その一瞬の感動を手のひらに。
            </h2>
            <p className="mt-4 text-sm sm:text-base text-gray-100">
              会場に行けない日でも、成長の瞬間を見逃さない。
            </p>
            <a
              href="/broadcast"
              className="inline-block mt-8 sm:mt-10 bg-[#e63946] hover:bg-[#d62836] text-white text-sm sm:text-base font-bold px-9 py-3.5 sm:px-11 sm:py-4 rounded-full transition shadow-2xl shadow-[#e63946]/30 hover:-translate-y-0.5 duration-300"
            >
              まずは10分間、無料で試す
            </a>
            <p className="mt-4 text-[10px] sm:text-xs text-gray-300">
              Webブラウザで今すぐ使えます / アプリならもっと安定（iOS / Android）
            </p>
            {/* Google Play バッジは余白込みPNGのため、可視高さが揃うよう h を大きめに指定 */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block hover:opacity-80 transition"
                aria-label="App Store で LIVE SPOtCH をダウンロード"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/appstore-badge-ja.svg"
                  alt="App Store でダウンロード"
                  width={136}
                  height={50}
                  className="h-[40px] w-auto"
                />
              </a>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block hover:opacity-80 transition"
                aria-label="Google Play で LIVE SPOtCH をダウンロード"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/google-play-badge-ja.png"
                  alt="Google Play で手に入れよう"
                  width={134}
                  height={52}
                  className="h-[52px] w-auto"
                />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* フッター */}
      <footer className="border-t border-white/5 py-6 sm:py-8 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-600">
            <p>© 2026 LIVE SPOtCH / LIN-NAH株式会社</p>
            <div className="flex flex-wrap gap-4 sm:gap-6 justify-center">
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-400 transition"
              >
                iOSアプリ（App Store）
              </a>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-400 transition"
              >
                Androidアプリ（Google Play）
              </a>
              <a href="/terms" className="hover:text-gray-400 transition">利用規約</a>
              <a href="/privacy" className="hover:text-gray-400 transition">プライバシーポリシー</a>
              <a href="/tokusho" className="hover:text-gray-400 transition">特定商取引法に基づく表示</a>
              <a href="/contact" className="hover:text-gray-400 transition">お問い合わせ</a>
            </div>
          </div>
          {/* ストアバッジ利用に伴う帰属表記（Google Play ブランドガイドライン準拠） */}
          <p className="mt-4 text-[10px] text-gray-700 text-center sm:text-right leading-relaxed">
            Google Play および Google Play のロゴは Google LLC の商標です。App Store は Apple Inc. のサービスマークです。
          </p>
        </div>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSONLD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APP_JSONLD) }}
      />
    </div>
  );
}
