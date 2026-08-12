import ExpoModulesCore
import HaishinKit
import RTMPHaishinKit
import AVFoundation
// kVTProfileLevel_H264_High_AutoLevel / VTCompressionSession* を使うために必要。
// HaishinKit は VideoToolbox を @_exported していないため、ここで明示的に import する。
import VideoToolbox
import UIKit

// カメラ＋マイクを RTMP(TCP/バッファ型) で push する Expo ネイティブ View。
// 4G でも「フレームを捨てず、詰まったらビットレートを下げて送り切る」ため安定・高画質。
// 送り先は LiveKit Ingress の RTMP URL（rtmpUrl + "/" + streamKey を JS 側で結合して渡す）。
//
// 制御は Prop 駆動（imperative ref 不要）:
//   - streamUrl: 完全な RTMP URL（空/nil の間は配信しない）
//   - active   : true で配信開始 / false で停止
//   - その他   : 解像度・ビットレート・fps・カメラ向き
// 状態は onStatus イベントで JS に通知（connecting / open / closing / closed / error）。
class RtmpPublisherView: ExpoView {
  private let mtView = MTHKView(frame: .zero)
  private let mixer = MediaMixer()
  private var session: (any Session)?
  private var readyStateTask: Task<Void, Never>?
  private var interruptTask: Task<Void, Never>?
  // 音声を映像と別キャプチャ(AVAudioEngine)で取得するための音声ソース。
  // capture session を映像専用にして着信で映像が止まらないようにするため（着信継続）。
  private var audioSource: AudioEngineSource?

  // Props（JS から設定）
  var streamUrl: String?
  var active: Bool = false
  var videoWidth: Int = 1280
  var videoHeight: Int = 720
  var videoBitrate: Int = 6_000_000
  var fps: Double = 60
  var cameraPosition: String = "back"

  // スコアボード焼き込み（スパイク検証用）。
  // JS 側で整形した1行文字列を渡し、ネイティブ（GPU合成）で映像に焼き込む。
  // ＝ブラウザCanvas合成と違い発熱主因にならないかを実機で検証する。
  var scoreboardText: String = ""
  var scoreboardVisible: Bool = true

  private var isMixerReady = false
  private var isStreaming = false

  // 画面合成（offscreen）に載せるスコアボードのテキストオブジェクト。
  // TextScreenObject は @ScreenActor 隔離クラス＝Sendable なので MainActor 保持でも安全に受け渡せる。
  private var scoreboardObject: TextScreenObject?

  let onStatus = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    mtView.videoGravity = .resizeAspectFill
    addSubview(mtView)
    // 端末の物理向きに追従してカメラ向きを更新する（横持ちの左右どちらでも正立・上下逆を防ぐ）。
    UIDevice.current.beginGeneratingDeviceOrientationNotifications()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(deviceOrientationChanged),
      name: UIDevice.orientationDidChangeNotification,
      object: nil
    )
    // 通話(AVAudioSession割り込み)終了後に audio session を再有効化する。HaishinKit は
    // audioIO.resume()(マイク再attach)はするが setActive(true) を呼ばないため、端末によって
    // マイク route が戻らない事象を補う（映像は通話中も継続している）。
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAudioInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil
    )
    Task { await self.setupMixer() }
  }

  // 端末を横に回したら配信映像を正立させる。iOS17+ の videoRotationAngle を live 接続に再適用。
  // 縦持ち等は無視して直近の横を維持（出力は常に 1280x720 横固定＝配信中の解像度変更不可のため）。
  @objc private func deviceOrientationChanged() {
    guard let angle = landscapeRotationAngle(for: UIDevice.current.orientation) else { return }
    let mixer = self.mixer
    Task {
      try? await mixer.configuration(video: 0) { unit in
        if #available(iOS 17.0, *) {
          if let conn = unit.connection, conn.isVideoRotationAngleSupported(angle) {
            conn.videoRotationAngle = angle
          }
          for c in unit.output?.connections ?? [] where c.isVideoRotationAngleSupported(angle) {
            c.videoRotationAngle = angle
          }
        }
      }
    }
  }

  // 着信(.began)=音声HWが電話に占有される → 音声エンジン停止（音声のみ無音。映像は capture 専用化で継続）。
  // 通話終了(.ended)=audio session 再有効化＋音声エンジン再起動で音声だけ自動復帰
  //   （映像は音声と別キャプチャなので、着信中も通話後も無関係に流れ続ける）。
  @objc private func handleAudioInterruption(_ note: Notification) {
    guard
      let info = note.userInfo,
      let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }
    switch type {
    case .began:
      // 実マイクは使えなくなるが、無音を流し続けてストリーム(エンコーダ/多重化)を生かす＝映像継続。
      audioSource?.beginInterruption()
    case .ended:
      // ★2026-08-10: .shouldResume の有無に関わらず復帰を試みるよう変更した。
      //
      // 【なぜ】以前は `.shouldResume` が付いているときだけ復帰していた。しかし
      //   **iOS はこの印を必ず付けるわけではなく、特に LINE通話のような VoIP アプリでは
      //   付かないことがある**。印が来なければこの分岐は何もせず、音声セッションが
      //   非アクティブのまま固定される＝マイクが戻らず、JS 側の中断フラグも解除されず、
      //   再接続ループが「通話中だから待つ」を無限に繰り返してデッドロックする。
      //   2026-08-09 の関東大会準決勝（サレジオ vs 日本航空・実顧客）で、LINE通話のあと
      //   **72分の試合の残り全部が静止画のまま配信された**。
      //
      // 印を無視して復帰を試みても、失敗すれば例外が返るだけで悪化はしない（fail-safe）。
      resumeAudioSession(attempt: 0)
    @unknown default:
      break
    }
  }

  /// 音声セッションを再有効化してマイクを復帰させる。失敗したら間隔を空けて数回やり直す。
  ///
  /// 通話終了直後は相手アプリがまだ音声デバイスを掴んでいて `setActive(true)` が
  /// 失敗することがある。一度きりの試行だと、そこで諦めて永久に無音のままになる。
  private func resumeAudioSession(attempt: Int) {
    let maxAttempts = 6      // 1秒間隔で最大6回＝約6秒粘る
    do {
      try AVAudioSession.sharedInstance().setActive(true)
      audioSource?.endInterruption() // 無音を止めて実マイクへ復帰
    } catch {
      guard attempt < maxAttempts else {
        // 復帰できなかった。JS 側には watchdog があり、中断が長引けば
        // 接続を作り直して復旧するので、ここで配信を落としたりはしない。
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
        self?.resumeAudioSession(attempt: attempt + 1)
      }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    mtView.frame = bounds
  }

  private func devicePosition() -> AVCaptureDevice.Position {
    cameraPosition == "front" ? .front : .back
  }

  // iOS17+ の videoRotationAngle（度・時計回り）。背面カメラの横固定用。
  // 0=横(端末 landscapeLeft) / 180=横(端末 landscapeRight)。縦持ち等は nil（直近の横を維持）。
  private func landscapeRotationAngle(for orientation: UIDeviceOrientation) -> CGFloat? {
    switch orientation {
    case .landscapeLeft: return 0
    case .landscapeRight: return 180
    default: return nil
    }
  }

  private func setupMixer() async {
    let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: devicePosition())
    // ★iOS17+ は videoOrientation が無視される端末が多い（HaishinKit は videoOrientation のみ設定し、
    //   isVideoOrientationSupported=false の端末では何もしない＝縦のまま）。そこで capture 接続に
    //   iOS17+ の正API videoRotationAngle を直接設定して横向きにする。configuration ブロックは
    //   session 追加前に実行され、HaishinKit は videoRotationAngle を一切触らないため上書きされない。
    let initialAngle = landscapeRotationAngle(for: UIDevice.current.orientation) ?? 0
    try? await mixer.attachVideo(camera, track: 0) { unit in
      if #available(iOS 17.0, *) {
        if let conn = unit.connection, conn.isVideoRotationAngleSupported(initialAngle) {
          conn.videoRotationAngle = initialAngle
        }
        for c in unit.output?.connections ?? [] where c.isVideoRotationAngleSupported(initialAngle) {
          c.videoRotationAngle = initialAngle
        }
      }
    }
    // ★着信継続: 音声は capture session に attach しない（映像専用）。音声+映像を同一セッションに
    //   同居させると、着信で音声HW(audioDeviceInUseByAnotherClient)が奪われた時にセッションごと
    //   中断され映像も止まる。映像専用セッションは音声HWに依存しないので着信に巻き込まれない。
    //   音声は AVAudioEngine で別取得し mixer.append で供給する（HaishinKit Example の .audioEngine 構成）。
    await mixer.addOutput(mtView)
    // 音声ソースを用意（self を @Sendable クロージャに捕えないよう mixer をローカルへ）。
    // ※ automaticallyConfiguresApplicationAudioSession は既定 true のまま（HaishinKit Example の
    //   .audioEngine 構成に合わせる）。AudioSession のカテゴリ/activate は startStreaming で行う。
    // start() は AudioSession を activate する startStreaming 側で呼ぶ（engine.start は activate 後が安全）。
    let mixerForAudio = self.mixer
    audioSource = AudioEngineSource(append: { buffer, when in
      await mixerForAudio.append(buffer, when: when)
    })

    // passthrough（既定）＝カメラの capture バッファをそのまま出力する経路。
    // スコアは視聴側 Web CSS オーバーレイに移したので端末 GPU 合成(offscreen)は不要。
    // ★offscreen だと screen 合成が setVideoOrientation を反映せず「縦帯＋90°回転」になる
    //   （実機＋HaishinKit 2.2.5 ソースで確認）。passthrough なら AVF が物理回転した
    //   1280x720 横・正立バッファがそのまま配信される（下の screen 関連設定は passthrough では不活性）。
    var settings = await mixer.videoMixerSettings
    settings.mode = .passthrough
    await mixer.setVideoMixerSettings(settings)
    // 向きは attachVideo の configuration で videoRotationAngle を設定済み。
    // 端末回転時は deviceOrientationChanged が mixer.configuration(video:0) で再適用する。
    // （setVideoOrientation は iOS17+ で無効なため呼ばない）
    try? await mixer.setFrameRate(fps)

    await mixer.startRunning()

    // 現在の Prop 値でオーバーレイを構築（以後の更新は applyScoreboard）。
    // self を @ScreenActor クロージャに捕まえないよう、必要な値はローカルに取り出して渡す。
    let mixer = self.mixer
    let w = CGFloat(videoWidth)
    let h = CGFloat(videoHeight)
    let str = scoreboardText
    let visible = scoreboardVisible
    let label = await Task { @ScreenActor () -> TextScreenObject in
      await mixer.screen.isGPURendererEnabled = true
      await mixer.screen.size = CGSize(width: w, height: h)
      let l = TextScreenObject()
      l.horizontalAlignment = .center
      l.verticalAlignment = .top
      l.layoutMargin = UIEdgeInsets(top: 24, left: 16, bottom: 0, right: 16)
      l.cornerRadius = 8
      l.attributes = [
        .font: UIFont.boldSystemFont(ofSize: 40),
        .foregroundColor: UIColor.white,
        .backgroundColor: UIColor.black.withAlphaComponent(0.55)
      ]
      l.string = str
      l.isVisible = visible && !str.isEmpty
      try? await mixer.screen.addChild(l)
      return l
    }.value
    scoreboardObject = label

    // 通話等で映像キャプチャ(AVCaptureSession)ごと中断される端末向け: isInterputted を購読し
    // JS へ interrupted/resumed を emit（JS側で同一パスへ remount=再接続）。
    // 音声のみの割り込み(着信)は HaishinKit が自動処理＝映像は継続するのでここには来ない。
    interruptTask?.cancel()
    interruptTask = Task { [weak self] in
      for await interrupted in await mixer.isInterputted {
        self?.emit(interrupted ? "interrupted" : "resumed")
      }
    }

    isMixerReady = true
    await reconcile()
  }

  // JS から scoreboardText / scoreboardVisible が更新されたら呼ぶ。
  // label は Sendable なのでローカルに取り出して @ScreenActor で更新（self 非捕捉）。
  func applyScoreboard() {
    guard let label = scoreboardObject else { return }
    let str = scoreboardText
    let visible = scoreboardVisible
    Task { @ScreenActor in
      label.string = str
      label.isVisible = visible && !str.isEmpty
    }
  }

  // Prop 更新のたびに呼び、active/url に応じて配信を開始・停止する。
  func reconcile() async {
    guard isMixerReady else { return }
    if active, !isStreaming, let url = streamUrl, !url.isEmpty {
      await startStreaming(url)
    } else if !active, isStreaming {
      await stopStreaming()
    }
  }

  private func emit(_ state: String, _ message: String? = nil) {
    DispatchQueue.main.async { [weak self] in
      self?.onStatus(["state": state, "message": message as Any])
    }
  }

  // ★この端末の H.264 ハードウェアエンコーダが High プロファイルを本当に受け付けるかを実測する
  //   （2026-08-13）。
  //
  // なぜ「実測」が要るか:
  // HaishinKit の setVideoSettings() は profileLevel が不正でも throw しない
  // （throw するのは HEVC 指定時など format が未対応のときだけで、H264 系の文字列では
  //   VideoCodecSettings.format が .h264 のままなので必ず成功する）。
  // 実際に効くのは **最初の映像フレームが来たとき**の VTCompressionSessionCreate →
  // VTSessionSetProperties で、ここが失敗すると VideoCodec.append の catch が
  // logger.warn するだけで握り潰され、**接続はできているのに映像が1フレームも出ない**
  // という最悪の壊れ方をする（配信画面は「配信中」に見えるのに視聴側が真っ暗）。
  //
  // High は A7 以降のハードウェアエンコーダが対応しており、iOS 16.4 が動く端末は
  // すべてこれを満たすため実際には落ちない想定。ただし「想定」で全国大会に臨むより、
  // 使い捨てのエンコーダセッションを1つ作って端末に直接聞く方が確実で、コストも数ミリ秒。
  // 非対応と分かった場合は profileLevel を触らない ＝ 1.1.7 と完全に同一の挙動に戻る。
  private static func supportsH264HighProfile(width: Int, height: Int) -> Bool {
    var probe: VTCompressionSession?
    let created = VTCompressionSessionCreate(
      allocator: kCFAllocatorDefault,
      width: Int32(width),
      height: Int32(height),
      codecType: kCMVideoCodecType_H264,
      encoderSpecification: nil,
      imageBufferAttributes: nil,
      compressedDataAllocator: nil,
      outputCallback: nil,
      refcon: nil,
      compressionSessionOut: &probe
    )
    guard created == noErr, let probe else { return false }
    // 実エンコーダセッションが作られる前に必ず破棄する（ハードウェアを掴んだままにしない）。
    defer { VTCompressionSessionInvalidate(probe) }

    // ★ProfileLevel だけを聞くのでは不十分。本番の HaishinKit は makeOptions() の
    //   全プロパティを **一括** で投入し、さらに prepareToEncodeFrames まで呼ぶ。
    //   High を受け付けても CABAC(H264EntropyMode) の同時投入や準備で失敗する端末が
    //   あった場合、本番の1フレーム目で throw → HaishinKit がログ1行で握り潰し →
    //   RTMPは繋がったまま「配信中」表示、視聴者は真っ暗、という最悪の壊れ方になる
    //   （2026-08-12 に別経路で実際に起きた「音声だけpublish」と同じ形）。
    //   そこで本番と同じ組み合わせを**予行演習**し、通ったときだけ High を採用する。
    //   増分コストは約1ms。
    let props: [CFString: Any] = [
      kVTCompressionPropertyKey_ProfileLevel: kVTProfileLevel_H264_High_AutoLevel,
      kVTCompressionPropertyKey_H264EntropyMode: kVTH264EntropyMode_CABAC,
      kVTCompressionPropertyKey_AllowFrameReordering: kCFBooleanFalse as Any,
      kVTCompressionPropertyKey_RealTime: kCFBooleanTrue as Any,
    ]
    guard VTSessionSetProperties(probe, propertyDictionary: props as CFDictionary) == noErr else {
      return false
    }
    // 準備まで通って初めて「この端末で本番と同じ設定が成立する」と言える。
    return VTCompressionSessionPrepareToEncodeFrames(probe) == noErr
  }

  private func startStreaming(_ urlStr: String) async {
    guard let url = URL(string: urlStr) else {
      emit("error", "invalid url")
      return
    }
    isStreaming = true
    do {
      let audioSession = AVAudioSession.sharedInstance()
      try? audioSession.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .allowBluetoothHFP])
      try? audioSession.setActive(true)

      emit("connecting")
      // RTMP セッションファクトリを登録（未登録だと make が notFound で失敗。重複登録は内部でガード）。
      await SessionBuilderFactory.shared.register(RTMPSessionFactory())
      guard let session = try await SessionBuilderFactory.shared.make(url).setMode(.publish).build() else {
        isStreaming = false
        emit("error", "session build failed")
        return
      }
      self.session = session

      let stream = await session.stream
      var vs = await stream.videoSettings
      vs.videoSize = CGSize(width: videoWidth, height: videoHeight)
      vs.bitRate = videoBitrate
      vs.expectedFrameRate = fps

      // ★H.264 プロファイルを Baseline → High へ（2026-08-13）。
      //
      // HaishinKit 2.2.5 の VideoCodecSettings.init の既定値は
      // `profileLevel: String = kVTProfileLevel_H264_Baseline_3_1` であり、これまで一度も
      // 上書きしていなかったため **iOS からの配信はずっと Baseline** で出ていた
      // （8/11 の実配信 HLS を ffprobe して profile=Baseline を確認。同日 Android は High）。
      //
      // High にすると VideoCodecSettings.makeOptions() が
      // `if !isBaseline && profileLevel.contains("H264") { H264EntropyMode = CABAC }`
      // を通り、エントロピー符号化が CAVLC → CABAC になる。CABAC は同じビットレートでも
      // 圧縮効率が上がるため、**解像度・ビットレート・fps を一切上げずに画質だけ改善する**。
      // 体育館のような細かい動き＋観客席のディテールで効きやすい。
      //
      // ★AutoLevel を選ぶ理由:
      // Level を固定（4.0 / 4.1 など）すると、将来 BroadcastScreen 側の解像度や fps を
      // 変えたときに Level 上限を踏み抜いてエンコーダが弾く事故が起きうる。AutoLevel なら
      // VideoToolbox が実際の解像度・fps・ビットレートから適切な Level を選ぶので取り違えが無い。
      // 現行の 1280x720/30fps/3.5Mbps は Level 3.1 の上限にすら収まっており余裕がある。
      //
      // ★受け側: 同日の Android(vc15) が既に High で配信し、MediaMTX → HLS → CloudFront →
      //   Web/アプリ視聴・YouTube アーカイブまで全て正常だった実績があるので下流は問題ない。
      if Self.supportsH264HighProfile(width: videoWidth, height: videoHeight) {
        vs.profileLevel = kVTProfileLevel_H264_High_AutoLevel as String

        // ★Bフレーム（フレーム並べ替え）は明示的に無効のままにする。
        //
        // makeOptions() は allowFrameReordering が nil のとき **`!isBaseline` にフォールバック**する:
        //   .init(key: .allowFrameReordering, value: (allowFrameReordering ?? !isBaseline) as NSObject)
        // つまり profileLevel を High にしただけで nil のまま放置すると、この値が
        // false → **true に変わり、Bフレームが有効化されてしまう**（High の副作用として自動で付いてくる）。
        //
        // Bフレームは表示順と符号化順がずれるため、エンコーダが後続フレームを待つぶん
        // 送出遅延が増える。本サービスは低遅延が売りではないものの、
        // 「スコアが映像より先に動く」ズレが既に課題として挙がっており、ここで遅延を
        // 増やすのは明確なマイナス。圧縮効率の利得は主に CABAC 側で取れるため、
        // Bフレームは見送って **遅延は 1.1.7 から一切変えない**。
        vs.allowFrameReordering = false
      }

      // ★瞬間ビットレートの上限を「最大値基準」で明示的に固定する（2026-08-07）。
      //
      // 既定は [0.0, 0.0]。この 0 は「未指定」を意味し、HaishinKit は
      // VideoCodecSettings.makeOptions() で **エンコーダセッションを作った時点の bitRate** から
      // `bitRate / 8 * 1.5` を計算してハード上限にする。
      // ところが invalidateSession() の比較対象に **bitRate は含まれていない**ため、
      // 後からビットレートを変えてもこの上限は再計算されない。
      //
      // 一方エンコーダセッションは「アプリのバックグラウンド復帰」と「着信などの音声中断の終了」で
      // 作り直される。つまり弱電波で 512kbps まで絞られた状態でホーム画面に行って戻ると、
      // 新しいセッションの上限が **768kbps に焼き付き**、その後 ConstantFPSBitRateStrategy が
      // 指令値を 3.5Mbps まで戻しても **実際の送出は 768kbps を超えられなくなる**
      // （＝配信を作り直すまで低画質のまま）。
      //
      // ★上限を外す（nil）のではなく videoBitrate 基準で固定するのが要点。
      //   バースト上限自体は残るので、CBR 化のような帯域の無駄遣いにはならない。
      vs.dataRateLimits = [Double(videoBitrate) / 8 * 1.5, 1.0]
      try await stream.setVideoSettings(vs)

      // ★音声 64kbps → 128kbps（2026-08-07）。
      // これまで setAudioSettings を一度も呼んでおらず、ライブラリ既定の
      // AudioCodecSettings.defaultBitRate = 64kbps のままだった。
      // 体育館は残響＋歓声＝広帯域ノイズで AAC が最も苦手な条件であり、かつ保護者が
      // 最も価値を感じるのは「子どもの名前が呼ばれた」「応援の声」といった音声情報。
      // +64kbps は映像予算 3.5Mbps に対して 1.8% でしかない。
      // 端末が対応しない値なら applicableEncodeBitRates により自動で丸められる。
      var aus = await stream.audioSettings
      aus.bitRate = 128_000
      // 失敗しても配信自体は続行させる（音声設定は"あれば良い"もので、
      // ここで throw すると配信開始そのものが落ちる＝最優先事項に反する）。
      try? await stream.setAudioSettings(aus)

      await mixer.addOutput(stream)
      // 音声エンジン開始（AudioSession activate 後・stream 配線後）。映像とは独立した音声経路。
      audioSource?.start()

      // アダプティブビットレート（★カスタム＝fpsは絶対に間引かない）。
      // 標準 StreamVideoAdaptiveBitRateStrategy は弱電波で frameInterval を上げフレーム間引き→
      // 可変fps化→送出映像に隙間→MediaMTX の HLS セグメント長が 2s→4s に変化し iOS 視聴が
      // 停止（"segment duration changed from 2s to 4s - this will cause an error in iOS clients"
      // を VPS ログで確認）。ConstantFPSBitRateStrategy は frameInterval を常に 0.0（=CFR・全
      // フレーム）に保ち、ビットレートだけを床(512kbps)付きで上下→セグメント長が一定でライブが死なない。
      await stream.setBitRateStrategy(
        ConstantFPSBitRateStrategy(mamimumVideoBitrate: videoBitrate, minimumVideoBitrate: 512_000)
      )

      readyStateTask?.cancel()
      readyStateTask = Task { [weak self] in
        guard let self else { return }
        for await state in await session.readyState {
          switch state {
          case .open: self.emit("open")
          case .connecting: self.emit("connecting")
          case .closing: self.emit("closing")
          case .closed: self.emit("closed")
          @unknown default: break
          }
        }
      }

      try await session.connect { [weak self] in
        self?.emit("error", "connection failed")
      }
    } catch {
      isStreaming = false
      emit("error", error.localizedDescription)
    }
  }

  private func stopStreaming() async {
    audioSource?.stop()
    readyStateTask?.cancel()
    readyStateTask = nil
    if let session {
      let stream = await session.stream
      await mixer.removeOutput(stream)
      try? await session.close()
    }
    session = nil
    isStreaming = false
    emit("closed")
  }

  func updateCamera() {
    Task {
      let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: devicePosition())
      try? await mixer.attachVideo(camera, track: 0)
    }
  }

  deinit {
    readyStateTask?.cancel()
    interruptTask?.cancel()
    audioSource?.dispose()
    NotificationCenter.default.removeObserver(self)
  }
}

// 音声を AVCaptureSession から切り離し AVAudioEngine で別取得する小クラス（着信継続のため）。
// capture session を映像専用にすると着信(音声HW占有)で映像が止まらない代わりに、音声はここで取得して
// mixer.append で配信に供給する。
//
// ★「音が重なる/順不同/積み上がる」を構造的に不可能にする設計:
//   - 配信への入口は AsyncStream の continuation 一本のみ。実マイク tap と無音タイマーは
//     beginInterruption で排他切替＝同時に yield することはない（二重供給なし）。
//   - 取り出しは単一の consumerTask が FIFO で1個ずつ await append＝順序保証・並列appendなし。
//   - unbounded＝音声を捨てない（捨てると多重化が音声待ちで映像が止まる）。append は軽量で追いつくため積み上がらない。
//   - start は running 中なら何もしない＋毎回 engine 新規化＝同一バスへ二重 installTap しない。
//   - dispose() で consumer も終了＝view 破棄/再接続(remount)で古い経路が残らない。
// start()/stop()/begin/endInterruption は MainActor から呼ぶ前提（engine/running/timer の直列化）。
final class AudioEngineSource: @unchecked Sendable {
  private var engine = AVAudioEngine()
  private var running = false
  private var lastFormat: AVAudioFormat?
  private var silenceTimer: DispatchSourceTimer?
  private var consumerTask: Task<Void, Never>?
  private let continuation: AsyncStream<(AVAudioPCMBuffer, AVAudioTime)>.Continuation

  init(append: @escaping @Sendable (AVAudioPCMBuffer, AVAudioTime) async -> Void) {
    var cont: AsyncStream<(AVAudioPCMBuffer, AVAudioTime)>.Continuation!
    // ★unbounded＝音声バッファを捨てない。有界(bufferingNewest)だと高負荷時に音声が欠落し、
    //   多重化が音声待ちになって映像まで止まる（着信時の停止と同じ機序）。append は軽量で
    //   コンシューマが追いつくため実際に積み上がらない＝前の動作実績ある「捨てない」挙動と同じ。
    let stream = AsyncStream<(AVAudioPCMBuffer, AVAudioTime)>(
      bufferingPolicy: .unbounded
    ) { cont = $0 }
    self.continuation = cont
    // 単一コンシューマが FIFO で1個ずつ append（順序保証・並列appendなし・積み上がりなし）。
    self.consumerTask = Task {
      for await pair in stream {
        await append(pair.0, pair.1)
      }
    }
  }

  // 通常配信: 実マイクをタップして配信へ。running 中の二重 start はしない（二重tap防止）。
  func start() {
    stopSilence()
    if running { return }
    engine = AVAudioEngine()
    let input = engine.inputNode
    let fmt = input.inputFormat(forBus: 0)
    guard fmt.channelCount > 0, fmt.sampleRate > 0 else { return }
    lastFormat = fmt
    let cont = continuation
    input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buffer, when in
      cont.yield((buffer, when))
    }
    engine.prepare()
    do {
      try engine.start()
      running = true
    } catch {
      // 音声のみ失敗。映像配信は継続する。
    }
  }

  // 着信(.began): 実マイクは使えないので停止し、代わりに「無音」を流し続けて
  // ストリーム(エンコーダ/多重化)を生かす＝映像が止まらない（着信継続の核心）。実マイクと無音は排他。
  func beginInterruption() {
    guard running else { return } // 配信(タップ)中でなければ何もしない
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    running = false
    startSilence()
  }

  // 着信終了(.ended): 無音を止めて実マイクへ復帰（音声自動復帰）。
  func endInterruption() {
    let wasSilencing = silenceTimer != nil
    stopSilence()
    if wasSilencing { start() }
  }

  // 配信停止時: 取り込み(マイク/無音)を止める。consumer は view 存続中は維持（次の start に備える）。
  func stop() {
    stopSilence()
    if !running { return }
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    running = false
  }

  // view 破棄時: 取り込み停止＋コンシューマ終了＋ストリーム終端（経路を完全解放＝再接続で残らない）。
  func dispose() {
    stop()
    consumerTask?.cancel()
    consumerTask = nil
    continuation.finish()
  }

  // 直近の音声フォーマットで無音バッファを 20ms ごとに append し続ける（着信中の継続用）。
  private func startSilence() {
    if silenceTimer != nil { return }
    let sampleRate = lastFormat?.sampleRate ?? 48000
    let channels = lastFormat?.channelCount ?? 1
    guard
      let fmt = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels)
    else { return }
    let frames = AVAudioFrameCount(max(1.0, sampleRate * 0.02)) // 20ms
    let cont = continuation
    let timer = DispatchSource.makeTimerSource(
      queue: DispatchQueue.global(qos: .userInitiated)
    )
    timer.schedule(deadline: .now(), repeating: .milliseconds(20))
    timer.setEventHandler {
      guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { return }
      buf.frameLength = frames
      if let f = buf.floatChannelData {
        for c in 0..<Int(fmt.channelCount) {
          memset(f[c], 0, Int(frames) * MemoryLayout<Float>.size)
        }
      }
      cont.yield((buf, AVAudioTime(hostTime: mach_absolute_time())))
    }
    timer.resume()
    silenceTimer = timer
  }

  private func stopSilence() {
    silenceTimer?.cancel()
    silenceTimer = nil
  }
}

// ビットレートのみを調整するアダプティブ戦略（frameInterval は絶対に触らない）。
//
// 標準 StreamVideoAdaptiveBitRateStrategy と違い、帯域不足時に videoSettings.frameInterval を
// 上げてフレームを間引くことは一切しない。frameInterval を常に 0.0（= VideoCodec.useFrame が
// 全フレームを処理 = CFR）に固定するため、送出フレームの PTS 間隔が規則的なままになり、下流
// HLS muxer（MediaMTX）でセグメント長が変化して iOS 視聴が停止する事象を防ぐ（7/19 本番の
// ライブ切断の根治。VPS ログの "segment duration changed from 2s to 4s" が原因）。帯域不足時は
// videoSettings.bitRate のみを下げ、視聴に耐える下限（床）で止める。
final actor ConstantFPSBitRateStrategy: StreamBitRateStrategy {
  // ★画質の復帰速度（2026-08-07 に 15 → 8 へ）。
  //
  // HaishinKit の NetworkMonitor は1秒間隔で評価し、送出キューが2回連続で増えただけで
  // 降格イベントを出す（measureInterval = 3）。5G のハンドオーバー1回でも簡単に発火する。
  // ＝ **降格は約2秒**。
  //
  // 一方、復帰はこの閾値ぶん .status を数えてから1段上げるので
  // 「16秒に1回 +最大値/10」でしか戻らない。512kbps → 3.5Mbps は9段＝**最短2分24秒**。
  // しかも途中で降格が1回でも来るとカウンタが 0 に戻る。**非対称は約70倍**だった。
  //
  // さらに、一気に最大へ戻す高速パス（NetworkMonitorEvent.reset）は
  // ライブラリのどこからも emit されない**死にコード**であることを確認済み
  // （HaishinKit 2.2.5 の Network/ 配下を全文検索して0件）。つまり実運用では
  // この匍匐前進だけが唯一の復帰手段。
  //
  // 体育館は一瞬の詰まりが多いため、これが「配信は止まらないが、ずっと汚いまま」
  // という形で顕在化する。16秒に1回でも詰まりが起きれば永久に床付近へ張り付く。
  //
  // ★5 まで下げないのは、上げるペースが速いほど帯域の限界を試す回数が増え、
  //   弱電波では上下動（＝見た目のちらつき）が増えるため。8 は約1分20秒で復帰する。
  static let statusCountsThreshold: Int = 8

  let mamimumVideoBitRate: Int  // 上限（ceiling）。プロトコル要件（綴りはライブラリ準拠）。
  let mamimumAudioBitRate: Int = 0
  let minimumVideoBitRate: Int  // 床（下限）。これ未満には絶対に下げない。

  private var sufficientBWCounts: Int = 0

  init(mamimumVideoBitrate: Int, minimumVideoBitrate: Int = 800 * 1000) {
    self.mamimumVideoBitRate = mamimumVideoBitrate
    self.minimumVideoBitRate = min(minimumVideoBitrate, mamimumVideoBitrate)
  }

  func adjustBitrate(_ event: NetworkMonitorEvent, stream: some StreamConvertible) async {
    switch event {
    case .status:
      // 帯域健全。ceiling へ向けてゆっくり戻す（回復時も fps 一定＝PTS連続）。
      var videoSettings = await stream.videoSettings
      guard videoSettings.bitRate < mamimumVideoBitRate else {
        sufficientBWCounts = 0
        return
      }
      if Self.statusCountsThreshold <= sufficientBWCounts {
        let incremental = max(mamimumVideoBitRate / 10, 1)
        videoSettings.bitRate = min(videoSettings.bitRate + incremental, mamimumVideoBitRate)
        videoSettings.frameInterval = 0.0  // 常に 0.0 に固定（CFR維持・絶対に上げない）
        try? await stream.setVideoSettings(videoSettings)
        sufficientBWCounts = 0
      } else {
        sufficientBWCounts += 1
      }

    case .publishInsufficientBWOccured(let report):
      // 送出キューが詰まっている。bitRate だけ下げる（fps は絶対に落とさない）。
      sufficientBWCounts = 0
      var videoSettings = await stream.videoSettings
      let audioSettings = await stream.audioSettings

      let target: Int
      if 0 < report.currentBytesOutPerSecond {
        target = report.currentBytesOutPerSecond * 8 - audioSettings.bitRate
      } else {
        target = videoSettings.bitRate * 3 / 4
      }
      let clamped = max(minimumVideoBitRate, min(target, videoSettings.bitRate))
      if clamped != videoSettings.bitRate {
        videoSettings.bitRate = clamped
        videoSettings.frameInterval = 0.0  // frameInterval10/05 を絶対に入れない
        try? await stream.setVideoSettings(videoSettings)
      }

    case .reset:
      var videoSettings = await stream.videoSettings
      sufficientBWCounts = 0
      videoSettings.bitRate = mamimumVideoBitRate
      videoSettings.frameInterval = 0.0
      try? await stream.setVideoSettings(videoSettings)
    }
  }
}
