export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 pb-20">
      <h1 className="text-xl font-bold">プライバシーポリシー</h1>
      <p className="mt-2 text-[10px] text-gray-600">最終更新日: 2026年4月11日</p>

      <div className="mt-8 space-y-8 text-sm text-gray-300 leading-relaxed">
        <section>
          <p>
            LIVE SPOtCH運営事務局（以下「当事務局」）は、ライブ配信サービス「LIVE SPOtCH」（以下「本サービス」）におけるユーザーの個人情報の取り扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">1. 収集する情報</h2>
          <p>当事務局は、本サービスの提供にあたり、以下の情報を収集します。</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
            <li><strong className="text-gray-300">アカウント情報</strong>: メールアドレス、パスワード（暗号化して保存）、表示名</li>
            <li><strong className="text-gray-300">ソーシャルログイン情報</strong>: Google、LINE、Facebookアカウントの公開プロフィール情報（名前、メールアドレス、プロフィール画像）</li>
            <li><strong className="text-gray-300">配信データ</strong>: チーム名、スコア、大会名、会場名、配信映像</li>
            <li><strong className="text-gray-300">利用情報</strong>: アクセスログ、デバイス情報、IPアドレス</li>
            <li><strong className="text-gray-300">決済情報</strong>: クレジットカード情報（決済代行サービスが管理し、当事務局は直接保持しません）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">2. 利用目的</h2>
          <p>収集した情報は、以下の目的で利用します。</p>
          <ol className="list-decimal list-inside mt-2 space-y-1 text-gray-400">
            <li>本サービスの提供・運営</li>
            <li>アカウント認証・セキュリティの確保</li>
            <li>料金の請求・決済処理</li>
            <li>お問い合わせへの対応</li>
            <li>サービスの改善・新機能の開発</li>
            <li>重要なお知らせの通知</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">3. 第三者への提供</h2>
          <p>当事務局は、以下の場合を除き、ユーザーの個人情報を第三者に提供しません。</p>
          <ol className="list-decimal list-inside mt-2 space-y-2 text-gray-400">
            <li>ユーザーの同意がある場合</li>
            <li>法令に基づく場合</li>
            <li>
              本サービスの提供に必要な範囲で、以下の外部サービスプロバイダーに委託する場合
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-gray-500">
                <li>Supabase（データベース・認証基盤）</li>
                <li>LiveKit（映像配信基盤）</li>
                <li>Vercel（ホスティング）</li>
                <li>Stripe（決済処理）※導入予定</li>
              </ul>
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">4. Cookieの使用</h2>
          <p className="text-gray-400">
            本サービスでは、認証状態の維持およびサービスの利便性向上のためにCookieを使用します。
            ブラウザの設定によりCookieを無効にすることができますが、一部の機能が利用できなくなる場合があります。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">5. データの保管・保護</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>ユーザーの個人情報は、適切なセキュリティ対策を講じた上で保管します。</li>
            <li>パスワードは暗号化して保存し、当事務局のスタッフを含め誰も閲覧できません。</li>
            <li>配信映像データは、配信終了後一定期間保存した後、自動的に削除されます。</li>
            <li>通信はすべてSSL/TLSにより暗号化されています。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">6. ユーザーの権利</h2>
          <p className="text-gray-400">
            ユーザーは、当事務局に対して以下の請求を行うことができます。
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
            <li>保有する個人情報の開示請求</li>
            <li>個人情報の訂正・更新</li>
            <li>個人情報の削除（退会による）</li>
            <li>個人情報の利用停止</li>
          </ul>
          <p className="mt-2 text-gray-400">
            上記のご請求は、お問い合わせフォームまたはメールにてご連絡ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">7. 子どものプライバシー</h2>
          <p className="text-gray-400">
            本サービスはスポーツの試合配信を目的としており、配信映像に未成年者が映る場合があります。
            未成年者の試合を配信する場合は、保護者または指導者の責任のもとで行ってください。
            16歳未満の方がアカウントを作成する場合は、保護者の同意が必要です。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">8. ポリシーの変更</h2>
          <p className="text-gray-400">
            当事務局は、必要に応じて本ポリシーを変更することがあります。
            重要な変更がある場合は、本サービス上またはメールにてお知らせします。
            変更後のポリシーは、本サービス上に掲載した時点で効力を生じるものとします。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-white mb-3">9. お問い合わせ</h2>
          <p className="text-gray-400">
            個人情報の取り扱いに関するお問い合わせは、以下までご連絡ください。
          </p>
          <div className="mt-2 bg-[#111] border border-white/5 rounded-md px-4 py-3">
            <p className="text-xs text-gray-400">LIVE SPOtCH運営事務局</p>
            <p className="text-xs text-gray-500 mt-1">
              お問い合わせ: <a href="/contact" className="text-[#e63946] hover:underline">お問い合わせフォーム</a>
            </p>
          </div>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-white/5">
        <p className="text-[10px] text-gray-600">LIVE SPOtCH運営事務局</p>
        <a href="/lp" className="inline-block mt-4 text-xs text-gray-400 hover:text-white transition">
          ← トップに戻る
        </a>
      </div>
    </div>
  );
}
