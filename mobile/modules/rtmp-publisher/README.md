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
   - 本番では URL を **LiveKit Ingress**（`/api/livekit/ingress/start` の `rtmpUrl` + "/" + `streamKey`）に差し替える

## ⚠️ 初回EASビルドで確認すべき既知リスク（順に）
1. **Xcode/Swift バージョン**：HaishinKit 2.2.5 は **Swift 6.0 / Xcode 26 以上**が必要。EASビルドイメージが該当するか（`eas.json` の `image`）。古い場合はイメージを最新へ、または HaishinKit を対応版にピン。
2. **`spm_dependency`（podspec）**：Expo SDK 56 の SPM 取り込みが解決するか。失敗時はバージョン/プロダクト名（`HaishinKit`/`RTMPHaishinKit`）を確認。
3. **Swift 6 strict concurrency**：`RtmpPublisherView.swift` は actor 跨ぎ（MediaMixer/StreamSession の async）。警告/エラーが出たら isolation を調整（first-cut のため要反復の可能性）。
4. **RTMP URL の扱い**：`StreamSessionBuilderFactory.make(url)` に stream key を URL 末尾パスとして渡す方式（YouTube/Larix と同形）。Ingress でも同様に結合して渡す。

## 次（別PR）
`mobile/screens/BroadcastScreen.tsx` の配信経路を WebRTC publish → 本モジュール（RTMP→Ingress）へ置換。
配信開始時に `/api/livekit/ingress/start` で URL+key 取得 → `active=true`、終了で `active=false` ＋ `/api/livekit/ingress/stop`。
スコアは Supabase Realtime のまま・自社プレイヤー視聴とYouTubeスコア合成は無改修（サーバー側 PR #192 で対応済）。
