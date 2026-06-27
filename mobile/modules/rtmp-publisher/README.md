# rtmp-publisher（ネイティブRTMP送信モジュール）

カメラ＋マイクを **RTMP（TCP/バッファ型）** で push する Expo ネイティブモジュール。
4G でも「フレームを捨てず、詰まったらビットレートを下げて送り切る」ため**安定・高画質**
（＝WebRTC配信の「荒い・カクつく」を根本解決）。送り先は **LiveKit Ingress** の RTMP URL。

- iOS: **HaishinKit 2.2.5**（Swift Package Manager）を Expo SDK 56 の `spm_dependency`(podspec) で取り込み。
- 制御は **Prop 駆動**：`streamUrl`（完全URL）＋ `active`（true=配信/false=停止）＋ 解像度/bitrate/fps/カメラ。
- 状態は `onStatus` イベント（connecting / open / closing / closed / error）。

## 検証ビルド（オーナー作業・EAS）
ローカルモジュールなので Expo の autolinking が自動で拾います（app.json への追記不要）。

```bash
cd mobile
npx expo prebuild --clean      # ネイティブ生成（spm_dependency が解決されるか確認）
eas build --platform ios --profile development   # dev client（個人アカウント署名で今テスト可）
# 端末にインストール → expo start --dev-client
```

## 単体テスト（BroadcastScreen を触らずに確認）
1. `App.tsx` の先頭で一時的に `return <RtmpTestScreen />;`（`modules/rtmp-publisher/RtmpTestScreen`）を返す
2. 起動 → RTMP URL に **Larix で使った YouTube の URL**（`rtmp://a.rtmp.youtube.com/live2/＜キー＞`）を貼る
3. 「配信開始」→ **YouTube Studio のプレビュー**で映像・接続品質を確認（4Gで見比べ）
4. これが映れば「**ネイティブモジュールが RTMP を正しく送れる**」ことの実証
   - 本番では URL を **Bunny.net Stream の Live ingest**（RTMP）に差し替える（最終確定 / `secretary/notes/2026-06-24-decisions.md`「最終確定」）

## ★スパイク S0/S1：端末側スコア焼き込み＝発熱検証（設計の分かれ目）
スコアボード＋YouTubeアーカイブが絶対要件 → スコアは映像ピクセルへ焼き込み必須。
それを「サーバー」ではなく「**端末（ネイティブエンコーダ）**」で行えるかを検証する。
**仮説**: 以前の発熱主因は「ブラウザ Canvas 合成 ＋ WebRTC simulcast」。HaishinKit の **offscreen GPU 合成 ＋ ハードウェアH.264 ＋ RTMP単一エンコード**は別物で大幅に軽いはず。唯一の新負荷は **720p"60"fps（コマ2倍）**。

実装: `videoMixerSettings.mode = .offscreen` ＋ `mixer.screen` に `TextScreenObject` を1枚（`isGPURendererEnabled = true`）。標準 **720p/60fps/6Mbps**。
`RtmpTestScreen` がモックのスコアボード（毎秒進むクロック＋ホーム/アウェイ+1）を `scoreboardText` で渡す。**720p ⇄ fps切替（60/30）ボタン付き**。

### 実機テスト手順（発熱を正しく見るために）
1. `App.tsx` の先頭で一時的に `return <RtmpTestScreen />;`
2. **充電ケーブルは抜く**（過去の発熱事案は充電しながら配信が一因。充電すると判定が狂う）
3. 送信先に YouTube の RTMP URL を貼る → **「720p 60fps」のまま配信開始**
4. **20〜30分（できれば試合相当）連続**で配信し、端末の発熱・サーマルスロットリング（時間経過で画質/fpsが落ちる）を観察
5. 「画質: 60fps/30fps」ボタンで **30fps でも同様に20〜30分**テストし、発熱を比較
6. 並行で YouTube Studio プレビューで、スコア焼き込みの表示・更新・鮮明さ（720p）を確認
7. なるべく**最新フラッグシップでない代表的な端末**でも試す（実ユーザー想定）

### 判定
- ✅ 720p60 で発熱OK → **端末焼き込みで確定**（最安・最シンプル）
- ⚠️ 60fps が厳しい → **720p30 に落とす**（負荷半分・十分綺麗）
- ❌ 30fps でも厳しい → **サーバー側合成に退避**（＝以前の発熱対策と同思想・スマホ負荷ゼロ。代償＝再エンコード画質低下＋サーバー費）

## ⚠️ 初回EASビルドで確認すべき既知リスク（順に）
1. **Xcode/Swift バージョン**：HaishinKit 2.2.5 は **Swift 6.0 / Xcode 26 以上**が必要。EASビルドイメージが該当するか（`eas.json` の `image`）。古い場合はイメージを最新へ、または HaishinKit を対応版にピン。
2. **`spm_dependency`（podspec）**：Expo SDK 56 の SPM 取り込みが解決するか。失敗時はバージョン/プロダクト名（`HaishinKit`/`RTMPHaishinKit`）を確認。
3. **Swift 6 strict concurrency**：`RtmpPublisherView.swift` は actor 跨ぎ（MediaMixer/Session の async）。警告/エラーが出たら isolation を調整。
4. **RTMP API（HaishinKit 2.2.5 実APIに準拠）**：型は `Session` / `SessionBuilderFactory` / `SessionMode.publish`（旧コードの `StreamSession` 系は誤り）。**`make()` の前に `SessionBuilderFactory.shared.register(RTMPSessionFactory())` の登録が必須**（未登録だと `notFound`）。stream key は URL 末尾パスで渡す（YouTube/Larix と同形）。

## 次（スパイク通過後）
`mobile/screens/BroadcastScreen.tsx` の配信経路を本モジュール（RTMP＋端末スコア焼き込み）へ置換。
配信開始時に **Bunny Stream 発行 API** で ingest URL+key を取得 → `active=true`、終了で `active=false`。
スコアは Supabase Realtime → 端末で `scoreboardText` に整形して焼き込み（全競技対応は P1-1）。
視聴は Bunny の HLS（Web `/watch`＋アプリ内）、¥500 はアーカイブを試合後 YouTube へアップロード。
詳細・最終確定 → `secretary/notes/2026-06-24-decisions.md`「最終確定」。
