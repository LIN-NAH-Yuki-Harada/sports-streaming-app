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
    Task { await self.setupMixer() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    mtView.frame = bounds
  }

  private func devicePosition() -> AVCaptureDevice.Position {
    cameraPosition == "front" ? .front : .back
  }

  private func setupMixer() async {
    let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: devicePosition())
    try? await mixer.attachVideo(camera, track: 0)
    try? await mixer.attachAudio(AVCaptureDevice.default(for: .audio))
    await mixer.addOutput(mtView)

    // スコアボードをピクセルへ焼き込むため offscreen 合成を有効化する。
    // 既定は .passthrough（合成されず素のカメラがそのまま流れる）。
    var settings = await mixer.videoMixerSettings
    settings.mode = .offscreen
    await mixer.setVideoMixerSettings(settings)
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
  }
}
