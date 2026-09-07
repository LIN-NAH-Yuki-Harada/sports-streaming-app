import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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

  return (
    <div>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD は静的データのみ
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      <div
        className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md px-5 md:px-8 lg:px-10 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Logo />
      </div>

      <article className="mx-auto max-w-3xl px-5 md:px-8 py-10 md:py-14 pb-20">
        <Link
          href="/blog"
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← ブログ一覧
        </Link>

        <h1 className="mt-4 text-xl md:text-2xl font-bold leading-snug">
          {post.title}
        </h1>
        <time
          dateTime={post.publishedAt}
          className="mt-3 block text-xs text-gray-500"
        >
          {formatDate(post.publishedAt)}
        </time>

        <div className="mt-8 space-y-4 text-sm md:text-[15px] text-gray-300 leading-relaxed">
          {post.lead.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>

        {/* 目次。長い記事なので、読みたい場所へ飛べるようにする */}
        <nav className="mt-10 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs font-bold text-gray-400">目次</p>
          <ul className="mt-3 space-y-2">
            {post.sections.map((s, i) => (
              <li key={s.heading}>
                <a
                  href={`#s${i}`}
                  className="text-sm text-gray-300 hover:text-white transition-colors"
                >
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-12 space-y-12">
          {post.sections.map((s, i) => (
            <section key={s.heading} id={`s${i}`} className="scroll-mt-24">
              <h2 className="text-base md:text-lg font-bold text-white border-l-2 border-[#e63946] pl-3">
                {s.heading}
              </h2>

              {s.paragraphs ? (
                <div className="mt-4 space-y-4 text-sm md:text-[15px] text-gray-300 leading-relaxed">
                  {s.paragraphs.map((p) => (
                    <p key={p.slice(0, 24)}>{p}</p>
                  ))}
                </div>
              ) : null}

              {s.list ? (
                <ul className="mt-4 space-y-2.5">
                  {s.list.map((item) => (
                    <li
                      key={item.slice(0, 24)}
                      className="flex gap-2.5 text-sm md:text-[15px] text-gray-300 leading-relaxed"
                    >
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#e63946]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {s.note ? (
                <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-gray-400 leading-relaxed">
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
      </article>
    </div>
  );
}
