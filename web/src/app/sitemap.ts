import type { MetadataRoute } from "next";
import { getSortedPosts } from "@/lib/blog";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://live-spotch.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // ブログ記事は lib/blog.ts の POSTS を参照して自動で載せる。
  // 記事を足したときに sitemap の編集を忘れる事故を防ぐため、手書きしない。
  const blogEntries: MetadataRoute.Sitemap = getSortedPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt ?? post.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/tokusho`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      // ログインできない方がアカウント削除を依頼するためのページ。
      // 辿り着けないと意味がないので sitemap にも載せる。
      url: `${SITE_URL}/account-deletion`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...blogEntries,
  ];
}
