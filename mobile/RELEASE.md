# LIVE SPOtCH 配信アプリ — リリース手順書（TestFlight → App Store）

> 目的: ネイティブ配信アプリを TestFlight に提出できる状態まで一貫して進めるための手順。
> 構成: Expo SDK56 + EAS Build / Submit。bundleId / package = `com.linnah.spotch`。

---

## 0. 前提（一度だけ）

- [x] Apple Developer 有効化（2026-06-11 Active）
- [x] EAS プロジェクト作成済み（projectId は app.json の `extra.eas.projectId`）
- [x] アイコン（`assets/icon.png` 1024×1024）/ スプラッシュ（`assets/splash-icon.png`）設定済み
- [ ] `eas login`（owner = `live-spotch` org）でログイン
- [ ] **App Store Connect でアプリ枠を作成**（下記「2. App Store Connect」）

---

## 1. ビルド（EAS Build）

```bash
cd mobile

# iOS 本番ビルド（TestFlight 用）
eas build -p ios --profile production

# Android 本番ビルド（内部テスト用・任意）
eas build -p android --profile production
```

- `production` プロファイルは `autoIncrement: true`＋`appVersionSource: remote` のため、
  ビルド番号は EAS が自動採番（手動で上げる必要なし）。
- 初回 iOS ビルドで証明書 / プロビジョニングプロファイルは EAS が対話生成（Apple ログインを求められる）。
- ⚠️ pod 地雷注意: Google Sign-In の modular_headers は `plugins/withGoogleSignInModularHeaders.js`
  で対処済み。ビルドが「Install pods」で落ちたらまずこの設定を疑う。

---

## 2. App Store Connect（アプリ枠の作成・オーナー操作）

https://appstoreconnect.apple.com → マイApp → ＋ → 新規App

| 項目 | 値 |
|------|-----|
| プラットフォーム | iOS |
| 名前 | LIVE SPOtCH 配信（重複不可・調整の可能性あり） |
| プライマリ言語 | 日本語 |
| バンドルID | `com.linnah.spotch`（Developer ポータルで先に登録が必要な場合あり） |
| SKU | 任意（例: `live-spotch-broadcaster`） |

作成後、以下の3値をメモ → §3 の `eas.json` に転記:

- **Apple ID（あなたのログインメール）** → `appleId`
- **App Store Connect の App ID（数字）** → `ascAppId`（アプリ「App情報」内）
- **Apple Team ID** → `appleTeamId`（Developer → Membership で確認できる10桁）

---

## 3. 提出（EAS Submit）

`eas.json` の `submit.production` に上記3値を埋める:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "<あなたのApple IDメール>",
      "ascAppId": "<App Store Connect の数字App ID>",
      "appleTeamId": "<10桁のTeam ID>"
    }
  }
}
```

```bash
# 直近の production ビルドを TestFlight に提出
eas submit -p ios --profile production --latest
```

- 値を埋めずに `eas submit` を実行しても、対話プロンプトで都度入力可能（埋めると無人化できる）。
- 提出後、App Store Connect → TestFlight に数十分〜で表示される。
  「Export Compliance」は `ITSAppUsesNonExemptEncryption: false`（app.json 設定済み）のため追加申告不要。

---

## 4. TestFlight 配布

1. 内部テスター（自分・最大100名）にすぐ配布可能（審査不要）。
2. 外部テスター配布は Apple のベータ審査（通常1日程度）が必要。
3. クラッシュ / フィードバックは TestFlight アプリから収集。

---

## 5. 本番審査で詰まりやすい点（事前メモ）

- **UGCモデレーション方針**: 配信は user generated。通報/ブロック導線の説明を審査メモに用意。
- **アカウント削除（5.1.1(v)）**: マイページ → 削除導線が必要（実装済み・要動作確認）。
- **年齢レーティング / 子ども安全**: 子どもが映る前提。Made for Kids 扱いとの整合に注意。
- **権限文言**: カメラ/マイクの用途文言は app.json に設定済み。

---

## 付録: バージョンの上げ方

ユーザー向けバージョン（`1.0.0`）を上げる時だけ app.json の `expo.version` を編集する。
ビルド番号は EAS が自動採番するので触らない。
</content>
</invoke>
