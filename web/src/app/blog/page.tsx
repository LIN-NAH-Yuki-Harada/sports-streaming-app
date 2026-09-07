import type { Metadata } from "next";
import Link from "next/link";
import { BlogFooter } from "@/components/blog-footer";
import { Logo } from "@/components/logo";
import { getSortedPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "ブログ",
  description:
    "子どもの試合のライブ配信について、実際に運営して分かったことをまとめています。少年野球・部活・スポーツ少年団の配信のやり方、注意点、失敗しやすいポイント。",
  alternates: { canonical: "/blog" },
  robots: { index: true, follow: true },
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export default function BlogIndexPage() {
  const posts = getSortedPosts();

  return (
    <div>
      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Logo />
      </div>

      <div className="mx-auto max-w-3xl px-5 md:px-8 py-10 md:py-14 pb-20">
        <nav aria-label="パンくず" className="text-xs text-gray-500">
          <Link href="/" className="hover:text-gray-300 transition-colors">
            ホーム
          </Link>
        </nav>

        <h1 className="mt-4 text-xl md:text-2xl font-bold">ブログ</h1>
        <p className="mt-3 text-sm text-gray-400 leading-relaxed">
          子どもの試合のライブ配信について、実際に運営して分かったことをまとめています。
        </p>

        <div className="mt-10 space-y-4">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block rounded-xl border border-white/10 bg-white/[0.02] p-5 md:p-6 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
            >
              <time
                dateTime={post.publishedAt}
                className="text-[11px] text-gray-500"
              >
                {formatDate(post.publishedAt)}
              </time>
              <h2 className="mt-2 text-base md:text-lg font-bold text-white leading-snug">
                {post.title}
              </h2>
              <p className="mt-2 text-sm text-gray-400 leading-relaxed">
                {post.excerpt}
              </p>
              <span className="mt-3 inline-block text-xs text-[#e63946]">
                続きを読む →
              </span>
            </Link>
          ))}
        </div>
      </div>

      <BlogFooter />
    </div>
  );
}
