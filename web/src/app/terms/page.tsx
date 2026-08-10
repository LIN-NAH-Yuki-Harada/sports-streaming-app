import { Logo } from "@/components/logo";

export default function TermsPage() {
  return (
    <div>
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        <Logo />
      </div>
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-10 md:py-14 pb-20">
      <h1 className="text-xl md:text-2xl font-bold">利用規約</h1>
      <p className="mt-2 text-xs text-gray-400">最終更新日: 2026年8月11日</p>

      <div className="mt-8 space-y-8 text-sm md:text-[15px] text-gray-300 leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-white mb-3">第1条（総則）</h2>
          <p>
            本利用規約（以下「本規約」）は、LIN-NAH株式会社（以下「当社」）が提供するライブ配信サービス「LIVE SPOtCH」（以下「本サービス」）の利用条件を定めるものです。
            ユーザーは本サービスを利用することにより、本規約に同意したものとみなします。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第2条（アカウント登録）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>本サービスの利用にはアカウント登録が必要です。</li>
            <li>ユーザーは、正確かつ最新の情報を登録するものとします。</li>
            <li>アカウントの管理責任はユーザーに帰属し、第三者への貸与・譲渡はできません。</li>
            <li>未成年者が本サービスを利用する場合は、保護者の同意を得た上で利用してください。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第3条（サービス内容）</h2>
          <p>本サービスは、スポーツの試合をスマートフォンで撮影し、リアルタイムでライブ配信するためのプラットフォームです。主に以下の機能を提供します。</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
            <li>ライブ映像配信</li>
            <li>スコアボード・オーバーレイ表示</li>
            <li>共有コードによる限定公開</li>
            <li>アーカイブ保存・再生（チームプラン）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第4条（料金・支払い）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li><strong className="text-gray-300">無料プラン</strong>: 視聴のみ。ライブ視聴に加え、チームプラン配信者のアーカイブ（YouTube限定公開）を視聴できます。</li>
            <li><strong className="text-gray-300">配信者プラン（月額300円）</strong>: ライブ配信、スコアボード・オーバーレイ、共有コード発行が利用可能です。初回10分間は無料でお試しいただけます。</li>
            <li>
              <strong className="text-gray-300">チームプラン（月額500円）</strong>: 配信者プランの全機能に加え、YouTube Live 同時配信、YouTube への自動アーカイブ保存、スケジュール管理、メンバー管理が利用可能です。
              <span className="block mt-1 text-gray-400">
                YouTube 関連の機能は、ユーザーご自身の YouTube アカウントを連携した場合にのみ動作します（初期状態は連携なし）。
                また、15分を超える録画の保存には、当該 YouTube チャンネルにおける電話番号確認が必要です。
                これらは YouTube 側の仕様によるもので、未設定の場合にアーカイブが保存されないことについて当社は責任を負いかねます。
              </span>
            </li>
            <li>料金はクレジットカード決済またはアプリ内課金（App Store / Google Play）による月額課金制です。</li>
            <li>プランの変更・解約はいつでも可能です。解約後も当月末まで利用できます。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第5条（禁止事項）</h2>
          <p>ユーザーは、以下の行為を行ってはなりません。</p>
          <ol className="list-decimal list-inside mt-2 space-y-1 text-gray-400">
            <li>法令または公序良俗に反する行為</li>
            <li>第三者の著作権、肖像権、プライバシーその他の権利を侵害する行為</li>
            <li>撮影対象者の同意を得ずに配信する行為</li>
            <li>わいせつ、暴力的、差別的なコンテンツの配信</li>
            <li>営利目的での無断転載・再配信</li>
            <li>本サービスの運営を妨害する行為</li>
            <li>他のユーザーのアカウントを不正に使用する行為</li>
            <li>その他、当社が不適切と判断する行為</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第6条（コンテンツの取り扱い）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>配信されるコンテンツの著作権は、配信者に帰属します。</li>
            <li>配信者は、配信内容が第三者の権利を侵害しないことを保証するものとします。</li>
            <li>当社は、本規約に違反するコンテンツを予告なく削除できるものとします。</li>
            <li>配信者は、本サービス上でのコンテンツの配信・保存に必要な範囲で、当社にコンテンツの利用を許諾するものとします。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第7条（サービスの中断・変更）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>当社は、システムの保守、天災、その他やむを得ない事由により、本サービスの全部または一部を中断することがあります。</li>
            <li>当社は、本サービスの内容を予告なく変更・追加・廃止することがあります。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第8条（免責事項）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>当社は、本サービスの完全性、正確性、有用性を保証するものではありません。</li>
            <li>配信の遅延、中断、データの消失等について、当社は責任を負いません。</li>
            <li>ユーザー間またはユーザーと第三者間のトラブルについて、当社は責任を負いません。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第9条（退会）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>
              ユーザーは、マイページからいつでも退会手続きを行うことができます。ログインできない場合は、
              <a href="/account-deletion" className="text-[#e63946] hover:underline">アカウント削除のご案内</a>
              に記載の方法で削除をご依頼いただけます。
            </li>
            <li>
              退会により、アカウント情報および当社のデータベース上の配信データは削除されます。
            </li>
            <li>
              ただし、法令の遵守・セキュリティ・不正防止等の正当な目的のため、退会後も一部の記録を一定期間保持します。
              決済・取引記録は税法・会計法令に基づき最長7年間（欠損金の繰越控除に関わる場合は最長10年間）、
              アクセスログ・IPアドレス・デバイス情報は一般に最大1年程度保持された後、削除・上書きされます。
            </li>
            <li>
              チームプランの YouTube 自動アーカイブで保存された動画は、配信者ご自身の YouTube チャンネル上にあるため、
              <strong className="text-gray-300">退会では削除されません</strong>。不要な場合は YouTube Studio でご自身で削除してください。
            </li>
            <li>
              アプリ内課金（App Store / Google Play）のサブスクリプションは、退会によって自動的には解約されません。
              追加の課金を防ぐため、退会の前に各ストアで解約手続きを行ってください。
            </li>
          </ol>
          <p className="mt-3 text-xs text-gray-400">
            詳細は
            <a href="/account-deletion" className="text-[#e63946] hover:underline mx-1">アカウント削除のご案内</a>
            をご確認ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第10条（規約の変更）</h2>
          <p className="text-gray-400">
            当社は、必要に応じて本規約を変更することがあります。変更後の規約は、本サービス上に掲載した時点で効力を生じるものとします。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第11条（準拠法・管轄裁判所）</h2>
          <p className="text-gray-400">
            本規約は日本法に準拠し、本サービスに関する一切の紛争は、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-white/5">
        <p className="text-[10px] text-gray-600">LIN-NAH株式会社</p>
        <a href="/" className="inline-block mt-4 text-xs text-gray-400 hover:text-white transition">
          ← トップに戻る
        </a>
      </div>
      </div>
    </div>
  );
}
