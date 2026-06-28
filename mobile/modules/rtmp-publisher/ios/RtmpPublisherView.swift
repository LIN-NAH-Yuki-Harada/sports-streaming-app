import ExpoModulesCore
import HaishinKit
import RTMPHaishinKit
import AVFoundation
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
  // 通話終了(.ended .shouldResume)=audio session 再有効化＋音声エンジン再起動で音声だけ自動復帰
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
      let optRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      if AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume) {
        try? AVAudioSession.sharedInstance().setActive(true)
        audioSource?.endInterruption() // 無音を止めて実マイクへ復帰
      }
    @unknown default:
      break
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
      try await stream.setVideoSettings(vs)
      await mixer.addOutput(stream)
      // 音声エンジン開始（AudioSession activate 後・stream 配線後）。映像とは独立した音声経路。
      audioSource?.start()

      // アダプティブビットレート：上り帯域(4G/5G)に応じて自動調整する。
      // 帯域不足時は videoBitrate を実効スループットまで下げ（必要ならフレームも間引き）、
      // 回復したら段階的に上限(videoBitrate)へ戻す。＝弱い4Gでも送信がバースト化せず、
      // 視聴側の定期フリーズ・録画分割・発熱を抑える（HaishinKit組み込み戦略）。
      await stream.setBitRateStrategy(
        StreamVideoAdaptiveBitRateStrategy(mamimumVideoBitrate: videoBitrate)
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
