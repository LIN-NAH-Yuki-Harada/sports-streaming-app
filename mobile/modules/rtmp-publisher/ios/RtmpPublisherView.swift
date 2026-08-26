import ExpoModulesCore
import HaishinKit
import RTMPHaishinKit
import AVFoundation
import CoreMedia
import Foundation
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
  /// 撮影ズームの倍率（1.0 = 等倍＝これまでと同じ画角）。
  /// ★1.0 を既定にすることで、この機能を入れても既存の配信者の画角は1ミリも変わらない。
  var zoom: Double = 1.0

  // 配信前の映像チェックの厳格度。JS から毎回渡す（既定は "warn"）。
  //   "off"   … 何もしない（緊急時の全停止スイッチ）
  //   "warn"  … 映像が来ていなくても **必ず配信は開始する**。JS に novideo を通知して
  //             画面に警告を出すだけ（＝正常な配信者を絶対に止めない）
  //   "block" … 映像が1枚も来ていなければ RTMP 接続そのものを張らない
  // ★既定を "warn" にしているのは意図的。ここを厳しくしすぎると、端末が遅い・
  //   体育館でカメラ起動が重い、といった正常系で全 iOS ユーザーが配信不能になる。
  //   "block" はサーバー設定で段階的に点灯させる想定（app.json の再ビルド不要）。
  var preflightMode: String = "warn"

  // スコアボード焼き込み（スパイク検証用）。
  // JS 側で整形した1行文字列を渡し、ネイティブ（GPU合成）で映像に焼き込む。
  // ＝ブラウザCanvas合成と違い発熱主因にならないかを実機で検証する。
  var scoreboardText: String = ""
  var scoreboardVisible: Bool = true

  /// いま attach しているカメラ。ズームは AVCaptureDevice に対して設定するため保持が要る。
  /// ★カメラを差し替える（前面/背面の切替や再 attach）たびに更新すること。
  /// ★強参照でよい: AVCaptureDevice は View を参照し返さないので循環しない。
  ///   weak にすると解放タイミング次第で黙って nil になり、ズームが無言で効かなくなる。
  private var currentCamera: AVCaptureDevice?

  private var isMixerReady = false
  private var isStreaming = false

  // ★映像が「本当に」流れているかを観測するための相乗りカウンタ（2026-08-12）。
  //
  // 【なぜ要るのか】2026-08-12 に MediaMTX の実ログで、RTMP publish が
  //   `1 track (MPEG-4 Audio)` ＝**音声トラックだけ**で成立している配信を確認した。
  //   配信者のアプリには「配信中」と出ており、視聴者だけが真っ暗を見ていた。
  //   同じ配信者が 07/12・07/14・08/12 と3回とも同じ壊れ方をしている。
  //   つまり「接続できた」は「映像が映っている」の証明に一切ならない。
  //
  // frameCounter は MediaMixer の映像出力に MTHKView と同じ資格で相乗りし、
  // フレームが1枚来るたびに数える。カメラが開けていなければ永遠に 0 のまま。
  private let frameCounter = VideoFrameCounter()
  private var frameProbe: FrameProbe?
  // カメラ attach に成功したか（権限拒否・他アプリ占有などで false）
  private var videoAttached = false
  // attach に失敗した理由（プリフライトのメッセージに載せて現場で切り分けるため）
  private var videoAttachError: String?
  // 配信中の映像生存監視（1秒 tick）の世代番号。停止時に +1 して古い tick を無効化する。
  private var mediaWatchGeneration = 0
  // 直近に novideo を通知したか（同じ状態を連投しないための1回きりガード）
  private var noVideoNotified = false

  // 配信開始前に「最初の1フレーム」を待つ上限。ここを超えても待ち続けない
  // （待たせ続ける＝配信が始まらない、が最悪の事故なので必ず打ち切る）。
  private static let preflightTimeoutMs = 4_000
  private static let preflightPollMs = 100
  // 配信中に何ミリ秒フレームが途切れたら「映像が届いていない」と見なすか。
  private static let noVideoThresholdMs: Double = 5_000

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
    // ★カメラ権限を最初に確認する（2026-08-12 追加）。
    //   これまで iOS 側には権限を確認するコードが**1行も無かった**。拒否されていても
    //   attachVideo の失敗は下の `try?` に飲み込まれ、そのまま「音声だけの配信」が
    //   成立していた（配信者は成功したと思い込み、視聴者だけが真っ暗を見る）。
    //
    // ★ここでは emit("error") しない。error は JS 側で「配信終了」に直結するため、
    //   起動途中の一時的な失敗で試合を止めてしまう。判定は startStreaming の
    //   プリフライト1箇所に集約し、preflightMode（既定 warn＝止めない）に従わせる。
    let camAuth = AVCaptureDevice.authorizationStatus(for: .video)
    if camAuth == .denied || camAuth == .restricted {
      // attach を試みても意味がないので行わない。理由だけ残す。
      videoAttached = false
      videoAttachError = "camera-denied"
    } else {
      let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: devicePosition())
      if camera == nil {
        videoAttached = false
        videoAttachError = "camera-not-found"
      } else {
        // ★iOS17+ は videoOrientation が無視される端末が多い（HaishinKit は videoOrientation のみ設定し、
        //   isVideoOrientationSupported=false の端末では何もしない＝縦のまま）。そこで capture 接続に
        //   iOS17+ の正API videoRotationAngle を直接設定して横向きにする。configuration ブロックは
        //   session 追加前に実行され、HaishinKit は videoRotationAngle を一切触らないため上書きされない。
        let initialAngle = landscapeRotationAngle(for: UIDevice.current.orientation) ?? 0
        do {
          // ★ここは以前 `try?` だった。**このアプリで唯一の「カメラが繋がらない」失敗点**
          //   なのに、例外が黙って消えていた＝映像なし配信の直接原因。理由を必ず外へ出す。
          try await mixer.attachVideo(camera, track: 0) { unit in
            if #available(iOS 17.0, *) {
              if let conn = unit.connection, conn.isVideoRotationAngleSupported(initialAngle) {
                conn.videoRotationAngle = initialAngle
              }
              for c in unit.output?.connections ?? [] where c.isVideoRotationAngleSupported(initialAngle) {
                c.videoRotationAngle = initialAngle
              }
            }
          }
          videoAttached = true
          videoAttachError = nil
          // ★ズームは attach の**後**に当てる。attach で activeFormat が決まり、
          //   その際 videoZoomFactor は 1.0 に戻るため、先に設定しても消える。
          currentCamera = camera
          applyZoom()
        } catch {
          videoAttached = false
          videoAttachError = "camera-attach-failed: \(error)"
        }
      }
    }
    // ★着信継続: 音声は capture session に attach しない（映像専用）。音声+映像を同一セッションに
    //   同居させると、着信で音声HW(audioDeviceInUseByAnotherClient)が奪われた時にセッションごと
    //   中断され映像も止まる。映像専用セッションは音声HWに依存しないので着信に巻き込まれない。
    //   音声は AVAudioEngine で別取得し mixer.append で供給する（HaishinKit Example の .audioEngine 構成）。
    await mixer.addOutput(mtView)
    // ★映像フレームの実在を数える相乗り出力。MTHKView とまったく同じ資格
    //   （videoTrackId = .max ＝合成後の映像出力）で受け取るだけで、映像には一切触らない。
    let probe = FrameProbe(counter: frameCounter)
    frameProbe = probe
    await mixer.addOutput(probe)
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

  /// 最初の映像フレームが来るまで待つ。来たら true、上限まで来なければ false。
  ///
  /// ★必ず上限（4秒）で打ち切る。ここで待ち続けると「配信開始を押しても始まらない」
  ///   という、映像なし配信よりずっと重い事故になる。
  /// ★mixer は View 生成時から動いているので、配信者が「配信開始」を押す頃には
  ///   通常すでに数百フレーム溜まっている＝この待ちは実際にはほぼ 0ms で抜ける。
  private func waitForFirstVideoFrame() async -> Bool {
    if frameCounter.count > 0 { return true }
    let tries = max(1, Self.preflightTimeoutMs / Self.preflightPollMs)
    for _ in 0..<tries {
      try? await Task.sleep(nanoseconds: UInt64(Self.preflightPollMs) * 1_000_000)
      if frameCounter.count > 0 { return true }
    }
    return false
  }

  /// 配信中の映像生存監視（1秒 tick）。
  /// 直近 noVideoThresholdMs フレームが来ていなければ novideo を1回だけ通知し、
  /// 復帰したら media を通知する。**ここから配信を止めることは絶対にしない**（通知のみ）。
  /// 監視の世代番号。停止/再開のたびに +1 して、古い tick を確実に無効化する
  /// （タイマーオブジェクトを持ち回すより取り違えが起きにくい）。
  private func startMediaWatch() {
    mediaWatchGeneration &+= 1
    scheduleMediaTick(generation: mediaWatchGeneration)
  }

  private func stopMediaWatch() {
    mediaWatchGeneration &+= 1
  }

  private func scheduleMediaTick(generation: Int) {
    // 既存の resumeAudioSession と同じ構成（main への asyncAfter 再帰）。
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
      self?.mediaTick(generation: generation)
    }
  }

  private func mediaTick(generation: Int) {
    guard generation == mediaWatchGeneration, isStreaming else { return }
    let last = frameCounter.lastAt
    let staleMs = last == 0
      ? Double(Self.noVideoThresholdMs) + 1
      : (CFAbsoluteTimeGetCurrent() - last) * 1000
    if staleMs > Self.noVideoThresholdMs {
      if !noVideoNotified {
        noVideoNotified = true
        emit("novideo", "no video for \(Int(min(staleMs, 999_999)))ms")
      }
    } else if noVideoNotified {
      noVideoNotified = false
      emit("media", "frames=\(frameCounter.count)")
    }
    scheduleMediaTick(generation: generation)
  }

  private func startStreaming(_ urlStr: String) async {
    guard let url = URL(string: urlStr) else {
      emit("error", "invalid url")
      return
    }
    isStreaming = true

    // ───────── 配信前チェック（毎回・RTMP を張る前） ─────────
    // 「権限がある」＝「カメラが使える」ではない。実データで、権限とは無関係に
    // 音声だけが publish された配信が3回確認されている。なので権限ではなく
    // **実際にフレームが1枚でも来たか**で判定する。
    if preflightMode != "off" {
      let ok = await waitForFirstVideoFrame()
      if ok {
        // 映像が来ていることを毎回はっきり通知する。JS はこれで警告表示を解除する
        // （再接続で View を作り直したときも、正常なら必ずここを通る）。
        noVideoNotified = false
        emit("media", "preflight ok frames=\(frameCounter.count)")
      } else {
        let detail = videoAttachError ?? "no-video-frames"
        if preflightMode == "block" {
          // ★このモードは既定では使わない。サーバー設定で段階的に点灯させる想定。
          isStreaming = false
          emit("error", "no-video: \(detail)")
          return
        }
        // 既定（warn）＝**配信は必ず開始する**。画面に警告を出すだけ。
        // 誤検知で試合を止めるくらいなら、映っていない配信を通したうえで
        // 配信者に気づいてもらう方がはるかにマシ、という判断。
        noVideoNotified = true
        emit("novideo", detail)
      }
    }

    // ★プリフライトは最大4秒このメソッドを中断させる。その間に配信者が「停止」を押すと
    //   reconcile → stopStreaming が先に走り切ってしまうが、session はまだ nil なので
    //   stopStreaming は何も閉じられない。そのままここへ戻ってくると
    //   **停止した後に RTMP を張る＝誰も止められないゴースト配信**になる。
    //   （通常は既にフレームがあり waitForFirstVideoFrame が即 return するのでここは通らない。
    //     カメラが壊れている時だけ開く窓なので、まさに事故が起きる場面と重なる。）
    //   active が false に戻っていたら、何もせず静かに降りる。
    guard active, isStreaming else {
      isStreaming = false
      return
    }

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

      // 配信中も映像が生きているか見張り続ける（通知のみ・停止は絶対にしない）。
      startMediaWatch()

      try await session.connect { [weak self] in
        self?.emit("error", "connection failed")
      }
    } catch {
      isStreaming = false
      stopMediaWatch()
      emit("error", error.localizedDescription)
    }
  }

  private func stopStreaming() async {
    stopMediaWatch()
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
      // ★カメラを差し替えるとズームは 1.0 に戻る。前面/背面を切り替えても
      //   配信者が選んだ倍率が保たれるよう、ここで必ず当て直す。
      currentCamera = camera
      applyZoom()
    }
  }

  /// 現在のカメラへズーム倍率を反映する。
  ///
  /// ★これは**デジタルズーム**（広角レンズの中央を切り出して拡大）。光学ズームではないため
  ///   倍率を上げるほど解像感は落ちる。配信は 1280x720 なので、2倍で実質 640x360 相当。
  ///   将来 .builtInTripleCamera 等の仮想デバイスに変えれば望遠レンズへ光学的に
  ///   切り替わるが、1.0 の画角が変わり既存配信者に影響するため v1 では採用しない。
  ///
  /// 端末が対応する範囲を超える値は黙って丸める（JS 側に上限を問い合わせる往復を作らない）。
  func applyZoom() {
    guard let device = currentCamera else { return }
    let maxFactor = min(device.activeFormat.videoMaxZoomFactor, RtmpPublisherView.zoomCap)
    let target = max(1.0, min(CGFloat(zoom), maxFactor))
    do {
      try device.lockForConfiguration()
      device.videoZoomFactor = target
      device.unlockForConfiguration()
    } catch {
      // ズームに失敗しても配信は続ける。ここで落とす価値はない。
    }
  }

  /// ズームの上限。端末は 100 倍以上を許すことがあるが、720p ではそこまで上げても
  /// 破綻した映像になるだけなので、実用範囲で頭打ちにする。
  private static let zoomCap: CGFloat = 5.0

  deinit {
    readyStateTask?.cancel()
    interruptTask?.cancel()
    audioSource?.dispose()
    NotificationCenter.default.removeObserver(self)
    // ★2026-08-12: View が壊されても RTMP セッションは自前で生き続けるため、
    //   ここで明示的に閉じないと**古い publisher のソケットが残る**。
    //   再接続で View を作り直すと、新旧2本の RTMP 接続が同じパスへ来て
    //   MediaMTX が "closing existing publisher" を出す（2026-08-12 の実ログ
    //   07:26:04 publish → 07:26:06 closing existing publisher と一致）。
    //   閉じる対象は **この View 自身の session だけ**。既に nil なら何もしない。
    //   self は捕えず、session だけをローカルに移して閉じる（deinit で self 捕捉は不正）。
    if let session = self.session {
      Task { try? await session.close() }
    }
  }
}

/// 映像フレームの到着回数と最終到着時刻だけを持つ、スレッド安全な小さな箱。
/// カメラのスレッドから毎フレーム bump され、UI 側（MainActor）から読まれる。
final class VideoFrameCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var _count: Int = 0
  private var _lastAt: CFAbsoluteTime = 0

  var count: Int {
    lock.lock(); defer { lock.unlock() }
    return _count
  }

  var lastAt: CFAbsoluteTime {
    lock.lock(); defer { lock.unlock() }
    return _lastAt
  }

  func bump() {
    lock.lock()
    _count &+= 1
    _lastAt = CFAbsoluteTimeGetCurrent()
    lock.unlock()
  }
}

/// MediaMixer の映像出力に相乗りして「フレームが来たか」だけを観測する。
///
/// 実装は HaishinKit 同梱の MTHKView（プレビュー用ビュー）の MediaMixerOutput 準拠を
/// そのまま踏襲している。videoTrackId = UInt8.max ＝「合成後の映像出力」を受け取る資格で、
/// passthrough モードではカメラのサンプルバッファがそのまま1枚ずつ流れてくる。
/// 映像そのものには一切触らない（数えるだけ）ので配信品質に影響しない。
@MainActor
final class FrameProbe: MediaMixerOutput {
  var videoTrackId: UInt8? = UInt8.max
  var audioTrackId: UInt8?

  private let counter: VideoFrameCounter

  init(counter: VideoFrameCounter) {
    self.counter = counter
  }

  nonisolated func mixer(_ mixer: MediaMixer, didOutput sampleBuffer: CMSampleBuffer) {
    counter.bump()
  }

  nonisolated func mixer(_ mixer: MediaMixer, didOutput buffer: AVAudioPCMBuffer, when: AVAudioTime) {
  }

  func selectTrack(_ id: UInt8?, mediaType: CMFormatDescription.MediaType) async {
    if mediaType == .video {
      videoTrackId = id
    }
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
