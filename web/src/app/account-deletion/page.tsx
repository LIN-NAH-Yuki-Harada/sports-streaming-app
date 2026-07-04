import type { Metadata } from "next";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "アカウント削除",
  description:
    "LIVE SPOtCH のアカウント削除（退会）方法、削除されるデータ・保持されるデータと保存期間、サブスクリプションの解約についてのご案内。",
  alternates: { canonical: "/account-deletion" },
  robots: { index: true, follow: true },
};

export default function AccountDeletionPage() {
  return (
    <div>
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Logo />
      </div>
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-10 md:py-14 pb-20">
        <h1 className="text-xl md:text-2xl font-bold">アカウント削除について</h1>
        <p className="mt-1 text-xs text-gray-500">
          Delete your LIVE SPOtCH account — by LIN-NAH株式会社
        </p>
        <p className="mt-2 text-[10px] text-gray-600">最終更新日: 2026年7月4日</p>

        <div className="mt-8 space-y-8 text-sm md:text-[15px] text-gray-300 leading-relaxed">
          <section>
            <p>
              LIVE SPOtCH運営事務局（以下「当事務局」）が提供する「LIVE
              SPOtCH」のアカウント削除（退会）方法と、削除によって消去されるデータ・保持されるデータについてご案内します。アプリを削除済みの場合や、ログインできない場合でも、本ページの手順でアカウント削除をご依頼いただけます。
            </p>
            <p className="mt-3 text-xs text-gray-500">
              This page explains how to delete your LIVE SPOtCH account (operated
              by LIVE SPOtCH運営事務局 / LIN-NAH株式会社). You can request
              deletion from within the app, from the website, or — if you cannot
              sign in — by email using the contact details below.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              ⚠️ 最初にご確認ください（サブスクリプションの解約）
            </h2>
            <p className="text-gray-400">
              アプリ内課金（App Store / Google
              Play）で有料プランにご登録の場合、
              <strong className="text-gray-300">
                アカウントを削除してもサブスクリプションは自動的には解約されません
              </strong>
              。課金は各ストア（Apple / Google）が管理しているため、当事務局側でアカウントを削除しても、ストアの定期購入は継続し課金が発生し続けます。追加の課金を防ぐため、アカウント削除の前に、必ずご自身でストアの解約手続きを行ってください。
            </p>
            <div className="mt-3 bg-[#111] border border-[#e63946]/40 rounded-md px-4 py-3">
              <p className="text-xs text-gray-400">
                <strong className="text-gray-300">iPhone / iPad（App Store）</strong>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                「設定」→ 一番上のApple ID →「サブスクリプション」→「LIVE
                SPOtCH」→「サブスクリプションをキャンセル」
              </p>
              <p className="text-xs text-gray-400 mt-3">
                <strong className="text-gray-300">Android（Google Play）</strong>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                「Google Play
                ストア」→ プロフィールアイコン →「お支払いと定期購入」→「定期購入」→「LIVE
                SPOtCH」→「定期購入を解約」
              </p>
              <p className="text-xs text-gray-500 mt-3">
                ※ Web（live-spotch.com）でクレジットカード決済されたプラン（Stripe）は、退会時に自動的に解約されます。
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              アカウント削除の手順
            </h2>
            <p className="text-gray-400">
              以下の3つの方法のいずれかで、アカウントの完全削除（退会）をご依頼いただけます。一時停止や凍結ではなく、アカウントと関連データを実際に削除します。
            </p>

            <h3 className="text-sm font-semibold text-gray-200 mt-5 mb-1">
              A. モバイルアプリ（iOS / Android）から
            </h3>
            <ol className="list-decimal list-inside mt-2 space-y-2 text-gray-400">
              <li>
                アプリ下部のタブから「<strong className="text-gray-300">マイページ</strong>」を開きます。
              </li>
              <li>
                画面下部の「<strong className="text-gray-300">アカウントを削除（退会）</strong>」をタップします。
              </li>
              <li>
                確認ダイアログ（「アカウントと配信データが完全に削除され、元に戻せません。削除しますか？」）で「<strong className="text-gray-300">削除する</strong>」をタップします。
                <span className="block mt-1 text-xs text-gray-500">
                  ※ アプリ内課金（App Store / Google
                  Play）の定期購入は、この操作では解約されません。上記「最初にご確認ください」の手順で別途ご自身で解約してください。
                </span>
              </li>
              <li>
                削除が完了すると自動的にログアウトされ、ログイン画面に戻ります。
              </li>
            </ol>

            <h3 className="text-sm font-semibold text-gray-200 mt-5 mb-1">
              B. Web版（live-spotch.com）から
            </h3>
            <ol className="list-decimal list-inside mt-2 space-y-2 text-gray-400">
              <li>
                <strong className="text-gray-300">live-spotch.com</strong>{" "}
                にログインし「<strong className="text-gray-300">マイページ</strong>」を開きます。
              </li>
              <li>
                ページ下部の「<strong className="text-gray-300">アカウントを削除（退会）</strong>」をクリックします。
              </li>
              <li>
                確認ダイアログ（「本当に退会しますか？」／「アカウントを削除すると、プロフィール・配信履歴などのすべてのデータが削除されます。この操作は取り消せません。」）で「<strong className="text-gray-300">退会する</strong>」をクリックします。
              </li>
              <li>完了するとログアウトされ、トップページに戻ります。</li>
            </ol>

            <h3 className="text-sm font-semibold text-gray-200 mt-5 mb-1">
              C. ログインできない場合 / メールでの削除依頼
            </h3>
            <p className="text-gray-400">
              アプリ・Webのどちらからも操作できない場合（アプリを削除済み・ログインできない等）は、
              <strong className="text-gray-300">登録メールアドレスを明記</strong>
              のうえ、以下のいずれかからアカウント削除をご依頼ください。本人確認の上で削除を実施します。ご依頼は通常
              <strong className="text-gray-300">7日以内</strong>
              に対応し、完了後にメールでご連絡します。
            </p>
            <div className="mt-2 bg-[#111] border border-white/5 rounded-md px-4 py-3">
              <p className="text-xs text-gray-400">LIVE SPOtCH運営事務局</p>
              <p className="text-xs text-gray-500 mt-1">
                メール: lin.nah.yuki@gmail.com
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                <a href="/contact" className="text-[#e63946] hover:underline">
                  お問い合わせフォーム
                </a>
                （件名に「アカウント削除」とご記入ください）
              </p>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              English: To request deletion, use the in-app or website
              &ldquo;アカウントを削除（退会） / Delete account&rdquo; button in マイページ
              (My Page). If you cannot sign in, email{" "}
              <strong className="text-gray-400">lin.nah.yuki@gmail.com</strong>{" "}
              from your registered address with the subject &ldquo;Account
              Deletion&rdquo;. Requests are processed within 7 days.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              削除でなくなるもの（削除されるデータ）
            </h2>
            <p className="text-gray-400">
              アカウントを削除すると、当事務局のデータベースから、あなたのアカウントおよび関連する以下のデータが完全に削除されます。
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-gray-400">
              <li>
                <strong className="text-gray-300">アカウント認証情報</strong>:
                メールアドレス、パスワード（暗号化ハッシュ）、Google / LINE /
                Facebook などのソーシャルログイン連携
              </li>
              <li>
                <strong className="text-gray-300">プロフィール情報</strong>:
                表示名、アバター画像、プラン情報、YouTube連携情報（チャンネルID・チャンネル名・アクセストークン）、Stripe顧客ID・サブスクID・サブスク状態
              </li>
              <li>
                <strong className="text-gray-300">あなたが作成したチーム</strong>:
                あなたが所有するチームそのものと、そのチームのメンバー登録
              </li>
              <li>
                <strong className="text-gray-300">チームメンバー登録</strong>:
                あなたが参加している他人所有のチームについては、チーム自体は残り、あなたの登録のみが削除されます
              </li>
              <li>
                <strong className="text-gray-300">配信（試合）データ</strong>:
                あなたの配信記録、および紐づくスコア・得点イベント・スコアボード／試合記録
              </li>
              <li>
                <strong className="text-gray-300">有料サブスクリプション（Web / Stripe決済分）</strong>:
                アカウント削除時に自動的に解約されます（StripeのサブスクIDがある場合）
              </li>
            </ul>
            <p className="mt-3 text-gray-400">
              <strong className="text-gray-300">
                この操作は取り消せません（元に戻せません）。
              </strong>
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              削除しても残るもの・保存期間（保持されるデータ）
            </h2>
            <p className="text-gray-400">
              法令の遵守、セキュリティ、不正防止などの正当な目的のため、アカウント削除後も一部の記録を一定期間保持することがあります。これらは他の目的での再識別には利用せず、保存期間の経過後に削除・上書きされます。
            </p>
            <ul className="list-disc list-inside mt-2 space-y-2 text-gray-400">
              <li>
                <strong className="text-gray-300">決済・取引記録</strong>:
                クレジットカードでのお支払い履歴等は、当事務局のデータベースからは削除されますが、決済代行事業者（Stripe）およびApple /
                Google側には、各社のポリシーおよび日本の税法・会計法令に基づき取引記録が保持されます。税務関連の帳簿・証憑は
                <strong className="text-gray-300">最長7年間</strong>
                （欠損金の繰越控除に関わる場合は最長10年間）保存されることがあります。これは法令上の義務であり、削除できません。
              </li>
              <li>
                <strong className="text-gray-300">アクセスログ等</strong>:
                セキュリティ・不正防止・障害対応の目的で、アクセスログ・IPアドレス・デバイス情報が、当事務局および委託先（Vercel /
                Supabase / LiveKit）のサーバーログとして
                <strong className="text-gray-300">
                  一定期間（一般に最大1年程度）
                </strong>
                保持された後、自動的に削除・上書きされます（プライバシーポリシー第1条・記載のログ情報）。
              </li>
              <li>
                <strong className="text-gray-300">配信映像</strong>:
                自社プレイヤーで配信された映像データは、プライバシーポリシー第5条のとおり「配信終了後一定期間保存した後、自動的に削除」されます（アカウント削除の有無にかかわらず）。
              </li>
              <li>
                <strong className="text-gray-300">
                  ⚠️ YouTube自動アーカイブ（チームプランのYouTube連携で保存された動画）
                </strong>
                :
                配信者ご自身のYouTubeチャンネルに限定公開として保存されるため、
                <strong className="text-gray-300">
                  アカウント削除では削除されません
                </strong>
                。不要な場合はYouTube側（YouTube
                Studio）でご自身で削除してください。
              </li>
              <li>
                <strong className="text-gray-300">匿名化・統計データ</strong>:
                個人を特定できないよう匿名化・集計した利用統計は、サービス改善のため保持することがあります。
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              ⚠️ App Store / Google Play のサブスクリプションについて
            </h2>
            <div className="bg-[#111] border border-[#e63946]/40 rounded-md px-4 py-3">
              <p className="text-xs text-gray-300">
                <strong>重要</strong>:
                アプリ内課金（App Store / Google
                Play）で有料プランにご登録の場合、アカウントを削除しても
                <strong>サブスクリプションは自動的には解約されません</strong>
                。アカウント削除とは別に、必ずご自身で解約手続きを行ってください。
              </p>
              <p className="text-xs text-gray-500 mt-2">
                <strong className="text-gray-400">iPhone / iPad</strong>:
                「設定」→ 一番上のApple ID →「サブスクリプション」→「LIVE
                SPOtCH」→「サブスクリプションをキャンセル」
              </p>
              <p className="text-xs text-gray-500 mt-1">
                <strong className="text-gray-400">Android</strong>: 「Google Play
                ストア」→ プロフィールアイコン →「お支払いと定期購入」→「定期購入」→「LIVE
                SPOtCH」→「定期購入を解約」
              </p>
              <p className="text-xs text-gray-500 mt-2">
                ※ Web（live-spotch.com）でクレジットカード決済されたプラン（Stripe）は、退会時に自動的に解約されます。
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              特定のデータのみの削除について
            </h2>
            <p className="text-gray-400">
              アカウントは残したまま、特定のコンテンツ（例:
              保存したアーカイブ動画・配信記録など）のみの削除をご希望の場合は、上記「C.
              メールでの削除依頼」またはお問い合わせフォームからご連絡ください。個別に対応いたします。
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-3">
              関連ページ
            </h2>
            <p className="text-gray-400">
              個人情報の取り扱いの詳細は、
              <a href="/privacy" className="text-[#e63946] hover:underline">
                プライバシーポリシー
              </a>
              をご確認ください。ご不明な点は
              <a href="/contact" className="text-[#e63946] hover:underline">
                お問い合わせフォーム
              </a>
              またはメール（lin.nah.yuki@gmail.com）までご連絡ください。
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-white/5">
          <p className="text-[10px] text-gray-600">LIVE SPOtCH運営事務局</p>
          <a
            href="/"
            className="inline-block mt-4 text-xs text-gray-400 hover:text-white transition"
          >
            ← トップに戻る
          </a>
        </div>
      </div>
    </div>
  );
}
