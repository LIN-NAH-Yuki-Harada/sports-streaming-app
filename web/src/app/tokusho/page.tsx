import type { Metadata } from "next";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表示",
  description:
    "LIVE SPOtCH の特定商取引法に基づく表示。販売業者・代表者・所在地・料金・支払方法・解約条件など、ご購入前にご確認ください。",
  alternates: { canonical: "/tokusho" },
  robots: { index: true, follow: true },
};

export default function TokushoPage() {
  return (
    <div>
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Logo />
      </div>
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-10 md:py-14 pb-20">
        <h1 className="text-xl md:text-2xl font-bold">特定商取引法に基づく表示</h1>
        <p className="mt-2 text-[10px] text-gray-600">最終更新日: 2026年4月23日</p>

        <div className="mt-8 space-y-0 text-sm md:text-[15px] text-gray-300">
          <dl className="divide-y divide-white/5 border-y border-white/5">
            <Row label="販売業者">
              LIN-NAH 株式会社
            </Row>

            <Row label="代表責任者">
              原田 佑樹
            </Row>

            <Row label="所在地">
              〒353-0005 埼玉県志木市幸町4-10-71
            </Row>

            <Row label="電話番号">
              090-5884-8132
              <br />
              <span className="text-xs text-gray-500 mt-1 inline-block">
                営業時間: 平日 10:00〜18:00（土日祝を除く）
              </span>
            </Row>

            <Row label="メールアドレス">
              lin.nah.yuki@gmail.com
            </Row>

            <Row label="URL">
              <a
                href="https://sports-streaming-app.vercel.app/"
                className="text-[#e63946] hover:underline"
              >
                https://sports-streaming-app.vercel.app/
              </a>
            </Row>

            <Row label="販売価格">
              <ul className="space-y-1 text-gray-300">
                <li>配信者プラン: 月額 300 円（税込）</li>
                <li>チームプラン: 月額 500 円（税込）</li>
                <li>視聴者プラン: 無料</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2">
                ※ 料金は予告なく改定する場合があります。改定時は事前にご案内いたします。
              </p>
            </Row>

            <Row label="商品代金以外の必要料金">
              <p>
                本サービスの利用にあたり必要となるインターネット通信料、モバイルデータ通信料、機器購入費用、電気代等は、お客様のご負担となります。
              </p>
            </Row>

            <Row label="お支払い方法">
              クレジットカード決済（Visa / Mastercard / JCB / American Express / Diners Club / Discover）
              <br />
              <span className="text-xs text-gray-500 mt-1 inline-block">
                決済代行サービス Stripe を通じて処理されます。お客様のカード情報は当社では一切保持しません。
              </span>
            </Row>

            <Row label="お支払い時期">
              月額プランは、初回ご登録時に初月分を決済し、以後は毎月自動更新（1 ヶ月ごと）にて継続課金いたします。
              <br />
              無料トライアル期間（クーポン適用時）は、トライアル終了日の翌日に初回決済が発生します。
            </Row>

            <Row label="サービスの提供時期">
              決済完了直後から、ご登録いただいたプランの機能をご利用いただけます。
            </Row>

            <Row label="解約・返品について">
              <p>
                本サービスは月額課金制のデジタルサービスのため、**原則として返金はいたしかねます**。
              </p>
              <p className="mt-3">
                解約はマイページ内「プラン管理」からいつでも行うことが可能です。解約後も、課金済みの当月末日までは引き続きご利用いただけます。日割りでの返金には対応しておりません。
              </p>
              <p className="mt-3">
                無料トライアル期間中に解約された場合、課金は発生しません。トライアル終了日までは引き続きご利用いただけます。
              </p>
              <p className="mt-3 text-xs text-gray-500">
                当社の責による不具合等でサービスが提供できない状態が継続した場合は、個別にご返金等の対応をさせていただきます。お問い合わせフォームよりご連絡ください。
              </p>
            </Row>

            <Row label="動作環境">
              <ul className="space-y-1 text-gray-300">
                <li>対応ブラウザ: Google Chrome / Safari / Microsoft Edge（各最新版）</li>
                <li>スマートフォン: iOS 15 以降 / Android 10 以降</li>
                <li>インターネット接続: 上り 2Mbps 以上（配信時）、下り 1.5Mbps 以上（視聴時）</li>
                <li>カメラ・マイク: 配信時にスマートフォン等のカメラ・マイクへのアクセス許可が必要です</li>
              </ul>
            </Row>

            <Row label="お問い合わせ">
              サービスに関するお問い合わせは、以下のフォームよりお願いいたします。
              <br />
              <a href="/contact" className="text-[#e63946] hover:underline mt-2 inline-block">
                /contact（お問い合わせフォーム）
              </a>
            </Row>
          </dl>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2 md:gap-6 py-4 md:py-5">
      <dt className="text-xs md:text-sm font-semibold text-gray-400">{label}</dt>
      <dd className="text-sm md:text-[15px] text-gray-300 leading-relaxed">{children}</dd>
    </div>
  );
}
