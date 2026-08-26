/**
 * 運用コストの台帳（PL ダッシュボードの入力）。
 *
 * ■ 正本はここ
 * 元は `.company/secretary/notes/running-costs.md` に手で書いていたが、
 * PL を出すには機械で読める形が要るため、こちらを正本に移した。
 * 金額が変わったらこのファイルを直す（＝git に履歴が残る）。
 *
 * ■ なぜ DB ではなくコードなのか
 * v1 では列追加のマイグレーションを避けた。コストは月に数回しか変わらず、
 * 変更は必ずレビューを通したい種類の値なので、コードで持つほうが安全。
 * 画面から編集したくなったら `operating_costs` テーブルへ移す（その時は列 GRANT を忘れない）。
 *
 * ■ ★確定していない金額は必ず confirmed:false にする
 * 未確認の額を黙って合計に混ぜると、PL が「それらしい嘘」になる。
 * 画面では確定分と未確認分を分けて表示する。
 */

/** 為替レート（USD→JPY）。ドル建てサービスの円換算に使う。 */
export const USD_JPY = 150;

/** 手数料率。経路で大きく違うため、売上を経路別に分けてから掛ける。 */
export const FEE_RATES = {
  /** Stripe（Web決済）: 3.6% 従量。固定費なし。 */
  stripe: 0.036,
  /**
   * App Store / Google Play の手数料。
   * ★**小規模事業者プログラム（年間100万ドル未満）に登録済みなら 15%**、未登録なら 30%。
   *   LIVE SPOtCH は売上規模的に確実に対象だが、**登録済みかどうかは要確認**。
   *   未登録のまま 15% で計算すると手取りを倍近く過大に見積もることになる。
   */
  inAppPurchase: 0.15,
} as const;

/** 手数料の前提が確認済みか。false のあいだは画面に注意書きを出す。 */
export const IAP_SMALL_BUSINESS_CONFIRMED = false;

export type CostItem = {
  name: string;
  /** 何に使っているか（オーナーが後から見て思い出せる粒度で） */
  purpose: string;
  /** 月額に換算した円。年額のものは 12 で割った額を入れる。 */
  monthlyJpy: number;
  /** 原文の金額表記（$50/月、¥12,980/年 など）。画面にそのまま出す。 */
  raw: string;
  /** 金額が確定しているか。false は合計に含めず別枠で見せる。 */
  confirmed: boolean;
  /** 削れるか。固定費の見直し時に効く。 */
  note?: string;
};

/**
 * 月次の固定費。
 * ★出典: `.company/secretary/notes/running-costs.md`（2026-07-13 棚卸し）＋その後の確認。
 */
export const MONTHLY_COSTS: CostItem[] = [
  {
    name: "LiveKit Cloud (Ship)",
    purpose: "ブラウザ配信の基盤（WebRTC / Egress）",
    monthlyJpy: 50 * USD_JPY,
    raw: "$50/月",
    confirmed: true,
    note: "Build プランでは Egress が起動できないため下げられない固定費",
  },
  {
    name: "EAS (Expo) Starter",
    purpose: "iOS / Android のアプリビルド",
    monthlyJpy: 45 * USD_JPY,
    raw: "$45/月",
    confirmed: true,
    note: "毎月11日にクレジットがリセット。超過分は追加課金",
  },
  {
    name: "Vercel Pro",
    purpose: "Web のホスティングと定期処理（cron）",
    monthlyJpy: 20 * USD_JPY,
    raw: "$20/月",
    confirmed: true,
    note: "無料プランは cron が1日1回に制限されるため戻せない",
  },
  {
    name: "Xserver VPS (2GB)",
    purpose: "配信サーバー（MediaMTX）とアーカイブ変換ワーカー",
    monthlyJpy: 1496,
    raw: "¥1,496/月（1ヶ月契約）",
    confirmed: true,
    note: "36ヶ月契約なら ¥990。2026-09-01 に全プラン値上げ",
  },
  {
    name: "Apple Developer Program",
    purpose: "App Store でのアプリ配信",
    monthlyJpy: Math.round(12980 / 12),
    raw: "¥12,980/年",
    confirmed: true,
    note: "更新日 2027-06-25。これが切れると App Store からアプリが消える",
  },
  {
    name: "Supabase",
    purpose: "データベース・認証・ストレージ",
    monthlyJpy: 25 * USD_JPY,
    raw: "$25/月（Pro と仮定）",
    confirmed: false,
    note: "★Pro か無料枠か未確認。無料枠なら ¥0",
  },
  {
    name: "独自ドメイン live-spotch.com",
    purpose: "ドメイン維持（お名前.com）",
    monthlyJpy: Math.round(3000 / 12),
    raw: "¥3,000/年（概算）",
    confirmed: false,
    note: "★正確な更新料が未記録",
  },
];

/** 確定している月額固定費の合計（円）。 */
export const confirmedMonthlyCost = () =>
  MONTHLY_COSTS.filter((c) => c.confirmed).reduce((s, c) => s + c.monthlyJpy, 0);

/** 未確認分を含めた月額固定費の合計（円）。＝ 最悪ケース。 */
export const maxMonthlyCost = () =>
  MONTHLY_COSTS.reduce((s, c) => s + c.monthlyJpy, 0);

/**
 * プランの月額（税込・表示価格）。
 * ★`web/src/app/pricing/page.tsx` の表示と必ず一致させること。
 */
export const PLAN_PRICES = {
  broadcaster: 300,
  team: 500,
} as const;

export type PaidPlan = keyof typeof PLAN_PRICES;
