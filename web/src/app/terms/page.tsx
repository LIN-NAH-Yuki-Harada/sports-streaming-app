export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 pb-20">
      <h1 className="text-xl font-bold">利用規約</h1>
      <p className="mt-2 text-[10px] text-gray-600">最終更新日: 2026年4月11日</p>

      <div className="mt-8 space-y-8 text-sm text-gray-300 leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-white mb-3">第1条（総則）</h2>
          <p>
            本利用規約（以下「本規約」）は、LIVE SPOtCH運営事務局（以下「当事務局」）が提供するライブ配信サービス「LIVE SPOtCH」（以下「本サービス」）の利用条件を定めるものです。
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
            <li>アーカイブ保存・再生（準備中）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第4条（料金・支払い）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li><strong className="text-gray-300">無料プラン</strong>: 視聴のみ。アーカイブ視聴機能は今後提供予定です。</li>
            <li><strong className="text-gray-300">配信者プラン（月額300円）</strong>: ライブ配信、スコアボード・オーバーレイ、共有コード発行、アーカイブ保存が利用可能です。初回10分間は無料でお試しいただけます。</li>
            <li><strong className="text-gray-300">チームプラン（月額500円）</strong>: 配信者プランの全機能に加え、大容量ストレージ、スケジュール管理、メンバー管理が利用可能です。</li>
            <li>料金はクレジットカード等による月額課金制です。</li>
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
            <li>その他、当事務局が不適切と判断する行為</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第6条（コンテンツの取り扱い）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>配信されるコンテンツの著作権は、配信者に帰属します。</li>
            <li>配信者は、配信内容が第三者の権利を侵害しないことを保証するものとします。</li>
            <li>当事務局は、本規約に違反するコンテンツを予告なく削除できるものとします。</li>
            <li>配信者は、本サービス上でのコンテンツの配信・保存に必要な範囲で、当事務局にコンテンツの利用を許諾するものとします。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第7条（サービスの中断・変更）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>当事務局は、システムの保守、天災、その他やむを得ない事由により、本サービスの全部または一部を中断することがあります。</li>
            <li>当事務局は、本サービスの内容を予告なく変更・追加・廃止することがあります。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第8条（免責事項）</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>当事務局は、本サービスの完全性、正確性、有用性を保証するものではありません。</li>
            <li>配信の遅延、中断、データの消失等について、当事務局は責任を負いません。</li>
            <li>ユーザー間またはユーザーと第三者間のトラブルについて、当事務局は責任を負いません。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第9条（退会）</h2>
          <p className="text-gray-400">
            ユーザーは、お問い合わせフォームまたはメールにて退会を申請することができます。退会後、アカウント情報および配信データは一定期間後に削除されます。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">第10条（規約の変更）</h2>
          <p className="text-gray-400">
            当事務局は、必要に応じて本規約を変更することがあります。変更後の規約は、本サービス上に掲載した時点で効力を生じるものとします。
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
        <p className="text-[10px] text-gray-600">LIVE SPOtCH運営事務局</p>
        <a href="/" className="inline-block mt-4 text-xs text-gray-400 hover:text-white transition">
          ← トップに戻る
        </a>
      </div>
    </div>
  );
}
