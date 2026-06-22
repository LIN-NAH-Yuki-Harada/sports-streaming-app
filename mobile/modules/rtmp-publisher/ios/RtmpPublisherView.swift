import ExpoModulesCore
import HaishinKit
import RTMPHaishinKit
import AVFoundation

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
  private var session: (any StreamSession)?
  private var readyStateTask: Task<Void, Never>?

  // Props（JS から設定）
  var streamUrl: String?
  var active: Bool = false
  var videoWidth: Int = 1280
  var videoHeight: Int = 720
  var videoBitrate: Int = 4_000_000
  var fps: Double = 30
  var cameraPosition: String = "back"

  private var isMixerReady = false
  private var isStreaming = false

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
    await mixer.startRunning()
    isMixerReady = true
    await reconcile()
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
      let session = try await StreamSessionBuilderFactory.shared.make(url).setMode(.publish).build()
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
