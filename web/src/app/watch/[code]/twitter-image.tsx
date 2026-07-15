export {
  default,
  alt,
  size,
  contentType,
  generateStaticParams,
} from "./opengraph-image";

// 60秒ISR（CDNキャッシュ）。理由は opengraph-image.tsx のコメント参照
// （LINE等がプレビューを自社側キャッシュするため毎回生成の鮮度メリットがなく、
//   毎リクエストのフォント取得+PNG生成がプレビュー体感を悪化させるだけだった）
export const revalidate = 60;
