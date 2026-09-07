import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogFooter } from "@/components/blog-footer";
import { Logo } from "@/components/logo";
import { POSTS, getPost } from "@/lib/blog";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com";

type Props = { params: Promise<{ slug: string }> };

// 記事は POSTS で確定しているので全件を静的生成する。
export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "記事が見つかりません" };

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `${SITE_URL}/blog/${post.slug}`,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
    },
  };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  // 記事構造化データ。Google に「これは記事である」と伝える。
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    inLanguage: "ja-JP",
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
    author: { "@type": "Organization", name: "LIN-NAH株式会社" },
    publisher: {
      "@type": "Organization",
      name: "LIVE SPOtCH",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` },
    },
  };

  // パンくず。検索結果にも階層が表示されるようになる。
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "ホーム", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "ブログ",
        item: `${SITE_URL}/blog`,
      },
      { "@type": "ListItem", position: 3, name: post.title },
    ],
  };

  return (
    <div>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD は静的データのみ
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD は静的データのみ
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Logo />
      </div>

      <article className="mx-auto max-w-3xl px-5 md:px-8 py-10 md:py-14 pb-20">
        {/* パンくず。検索から直接来た人に「いまどこにいるか」を示す */}
        <nav aria-label="パンくず" className="text-xs text-gray-500">
          <Link href="/" className="hover:text-gray-300 transition-colors">
            ホーム
          </Link>
          <span className="mx-1.5">›</span>
          <Link href="/blog" className="hover:text-gray-300 transition-colors">
            ブログ
          </Link>
        </nav>

        <h1 className="mt-4 text-[24px] md:text-[32px] font-bold leading-[1.4]">
          {post.title}
        </h1>
        <time
          dateTime={post.publishedAt}
          className="mt-3 block text-xs text-gray-500"
        >
          {formatDate(post.publishedAt)}
        </time>

        {/* ★検索から来た初見の人に「誰が書いたか」を最初に伝える。
            実際に運営している当事者が書いていることが、この記事の一番の強み。 */}
        <p className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-gray-400 leading-relaxed">
          この記事は、地域スポーツのライブ配信サービス「
          <Link href="/" className="text-gray-200 hover:text-white underline underline-offset-2">
            LIVE SPOtCH
          </Link>
          」を運営する LIN-NAH株式会社が書いています。
        </p>

        <div className="mt-8 space-y-5 text-[16px] md:text-[18px] text-gray-200 leading-[1.95]">
          {post.lead.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>

        {/* 目次。9項目あると縦に長く本文が押し下がるので、既定で折りたたむ。
            <details> なのでJSは不要、SSGでもそのまま動く。 */}
        <details className="mt-10 group rounded-xl border border-white/10 bg-white/[0.03]">
          <summary className="flex items-center justify-between cursor-pointer list-none px-5 py-4">
            <span className="text-[13px] font-bold text-gray-300">
              目次（{post.sections.length}項目）
            </span>
            <span
              className="text-xs text-gray-500 transition-transform duration-300 group-open:rotate-180"
              aria-hidden="true"
            >
              ▼
            </span>
          </summary>
          <ul className="px-5 pb-5 space-y-2.5">
            {post.sections.map((s, i) => (
              <li key={s.heading}>
                <a
                  href={`#s${i}`}
                  className="text-[14px] text-gray-400 hover:text-white transition-colors leading-relaxed"
                >
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </details>

        <div className="mt-14 space-y-16">
          {post.sections.map((s, i) => (
            <section key={s.heading} id={`s${i}`} className="scroll-mt-24">
              <h2 className="text-[19px] md:text-[23px] font-bold text-white leading-snug border-l-[3px] border-[#e63946] pl-4">
                {s.heading}
              </h2>

              {s.paragraphs ? (
                <div className="mt-5 space-y-5 text-[15.5px] md:text-[17px] text-gray-300 leading-[1.95]">
                  {s.paragraphs.map((p) => (
                    <p key={p.slice(0, 24)}>{p}</p>
                  ))}
                </div>
              ) : null}

              {s.list ? (
                <ul className="mt-5 space-y-3.5">
                  {s.list.map((item) => (
                    <li
                      key={item.slice(0, 24)}
                      className="flex gap-3 text-[15px] md:text-[16.5px] text-gray-300 leading-[1.9]"
                    >
                      <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#e63946]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {s.note ? (
                <p className="mt-5 rounded-lg border-l-2 border-white/20 bg-white/[0.03] px-4 py-3.5 text-[14px] md:text-[15px] text-gray-400 leading-[1.9]">
                  {s.note}
                </p>
              ) : null}
            </section>
          ))}
        </div>

        {/* 記事末尾の案内。押しつけず、視聴が無料であることを先に伝える */}
        <aside className="mt-16 rounded-xl border border-white/10 bg-white/[0.02] p-6">
          <p className="text-xs text-gray-500">
            ※ この記事はどの配信サービスでも使える内容としてまとめています。
          </p>
          <p className="mt-3 text-sm text-gray-300 leading-relaxed">
            LIVE SPOtCH は、子どもの試合をスマホ1台で配信できるアプリです。
            チーム名・得点・試合の経過時間を映像に重ねて表示できるので、
            得点板をカメラの前にかざす必要がありません。
          </p>
          <p className="mt-3 text-[13px] text-gray-400 leading-relaxed">
            見る側はアプリのインストールも会員登録も不要です。
            配信もはじめての方は10分間無料でお試しいただけます。
          </p>
          <Link
            href="/"
            className="mt-5 inline-block rounded-lg bg-[#e63946] px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
          >
            LIVE SPOtCH を見る
          </Link>
        </aside>

        <p className="mt-10 text-xs">
          <Link
            href="/blog"
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← ブログ一覧へ戻る
          </Link>
        </p>
      </article>

      <BlogFooter />
    </div>
  );
}
