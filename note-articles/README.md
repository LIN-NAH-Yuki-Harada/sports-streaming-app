# note-articles

ライブスポッチ公式 note (`note.com/live_spotch`) の記事原稿管理ディレクトリ。

## 目的

- note 公開記事のソース管理（バックアップ・履歴・検索）
- 他プラットフォーム（X・Instagram・TikTok）への素材転用
- 将来の SEO 用途・メディア寄稿用のストック
- 複数人運営移行時の引き継ぎ資料

## ファイル命名規則

```
YYYY-MM-DD-{english-slug}.md   # Markdown 版（管理用・Git 履歴用）
YYYY-MM-DD-{english-slug}.txt  # プレーンテキスト版（note エディタへのコピペ用）
```

例: `2026-04-26-hello-livespotch.md`

## ワークフロー

1. `.md` ファイルにフロントマター付きで原稿を作成（執筆段階）
2. オーナー監修・修正
3. `.txt` 版を生成（コピペ用）
4. note エディタに `.txt` の内容をコピペ → 装飾調整 → 公開
5. 公開後の note URL を `.md` のフロントマター `note_url` に記録
6. `status: published` に更新

## .md ファイルのフロントマター仕様

```yaml
---
title: "記事タイトル"
date: 2026-04-26          # 投稿日
status: draft             # draft | published
note_url:                 # 公開後にURLを記入
hashtags:                 # note のハッシュタグ
  - はじめてのnote
  - ライブスポッチ
target_persona:           # 想定読者ペルソナ（A〜E）
  - A
  - B
purpose:                  # 記事の主目的（ブランド構築 / SEO流入 / CV / 共感拡散）
  - ブランド構築
---
```

## 記事の戦略マッピング

| 種類 | 主目的 | 代表記事 |
|---|---|---|
| **ブランド構築型** | サービスの哲学・人格を伝える | 第1本「はじめまして」 |
| **SEO 流入型** | 検索ヒット → 公式サイト誘導 | 「子供の試合 ライブ配信 比較ガイド」（執筆予定） |
| **共感拡散型** | 体験ストーリーで感情拡散 | 「祖父母に孫の試合を届けた話」（執筆予定） |
| **業界論型** | メディア・関係者への引用素材 | 「ローカルスポーツとUGC」（執筆予定） |
| **実用ガイド型** | 配信者向けノウハウ | 「保護者が試合撮影で失敗しない7つのコツ」（執筆予定） |

## 関連リソース

- 戦略 memory: `~/.claude/projects/-Users-yukiharada-Desktop-Sports-Streeming/memory/project_sns_launch.md`
- 意思決定ログ: `.company/secretary/notes/2026-04-26-decisions.md`
- 公式 note: https://note.com/live_spotch
- 公式サイト: https://live-spotch.com/
