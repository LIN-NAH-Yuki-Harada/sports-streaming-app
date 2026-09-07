import Link from "next/link";

/**
 * ブログ（/blog 配下）専用のフッター。
 *
 * ★なぜ専用フッターが要るか:
 *   ブログ記事に来るのは**検索から来た未ログインの初見**が大半。
 *   その人にとって BottomNav（チーム/配信/履歴/マイページ）は
 *   全部ログインが必要で意味が分からず、離脱の原因になる。
 *   代わりに「ここは何のサイトか」と「次にどこへ行けるか」を示す。
 *
 *   法務リンクを置いているのは、記事だけ読んで帰る人に対して
 *   実在する会社が運営していることを示すため（信頼性）。
 */
export function BlogFooter() {
  return (
    <footer className="mt-16 border-t border-white/10 px-5 md:px-8 py-10">
      <p className="text-sm font-bold text-white">
        LIVE SPOtCH（ライブスポッチ）
      </p>
      <p className="mt-2 text-[13px] text-gray-400 leading-relaxed">
        子どもの試合を、スマホ1台でライブ配信。
        チーム名・得点・試合の経過時間を映像に重ねて表示できます。
        視聴する側はアプリも会員登録も不要です。
      </p>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        <Link href="/" className="text-[#e63946] hover:opacity-80 transition">
          サービスを見る
        </Link>
        <Link
          href="/pricing"
          className="text-gray-300 hover:text-white transition"
        >
          料金
        </Link>
        <Link href="/blog" className="text-gray-300 hover:text-white transition">
          ブログ
        </Link>
        <Link
          href="/contact"
          className="text-gray-300 hover:text-white transition"
        >
          お問い合わせ
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-gray-500">
        <Link href="/terms" className="hover:text-gray-300 transition">
          利用規約
        </Link>
        <Link href="/privacy" className="hover:text-gray-300 transition">
          プライバシーポリシー
        </Link>
        <Link href="/tokusho" className="hover:text-gray-300 transition">
          特定商取引法に基づく表示
        </Link>
      </div>

      <p className="mt-5 text-[11px] text-gray-500">
        © 2026 LIVE SPOtCH / LIN-NAH株式会社
      </p>
    </footer>
  );
}
