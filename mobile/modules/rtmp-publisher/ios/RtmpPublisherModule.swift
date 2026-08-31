import ExpoModulesCore
import AVFoundation

public class RtmpPublisherModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RtmpPublisher")

    // ───────── 配信前チェック用の API（View ではなく Module 関数）─────────
    // View がまだ存在しない「配信開始ボタンを押した直後」に呼ぶ必要があるため、
    // View 側ではなく Module 側に置く。Android 版と同じ名前・同じ戻り値の形。
    //
    // 戻り値: { camera: "granted"|"denied"|"undetermined", mic: 同じ }

    AsyncFunction("getDeviceStatus") { () -> [String: String] in
      return [
        "camera": rtmpAuthLabel(AVCaptureDevice.authorizationStatus(for: .video)),
        "mic": rtmpAuthLabel(AVCaptureDevice.authorizationStatus(for: .audio)),
      ]
    }

    // まだ未選択（undetermined）のものだけシステムダイアログを出す。
    // ★一度 "許可しない" を押されるとアプリからは二度と出せない（設定アプリ送りになる）ため、
    //   呼び出し側は必ず日本語の説明と設定アプリへの導線をセットで出すこと。
    AsyncFunction("requestDevicePermissions") { (promise: Promise) in
      Task {
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
          _ = await AVCaptureDevice.requestAccess(for: .video)
        }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
          _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
        promise.resolve([
          "camera": rtmpAuthLabel(AVCaptureDevice.authorizationStatus(for: .video)),
          "mic": rtmpAuthLabel(AVCaptureDevice.authorizationStatus(for: .audio)),
        ])
      }
    }

    View(RtmpPublisherView.self) {
      Events("onStatus")

      Prop("streamUrl") { (view: RtmpPublisherView, value: String?) in
        view.streamUrl = value
        Task { await view.reconcile() }
      }
      Prop("active") { (view: RtmpPublisherView, value: Bool) in
        view.active = value
        Task { await view.reconcile() }
      }
      Prop("videoWidth") { (view: RtmpPublisherView, value: Int) in
        view.videoWidth = value
      }
      Prop("videoHeight") { (view: RtmpPublisherView, value: Int) in
        view.videoHeight = value
      }
      Prop("videoBitrate") { (view: RtmpPublisherView, value: Int) in
        view.videoBitrate = value
      }
      Prop("fps") { (view: RtmpPublisherView, value: Double) in
        view.fps = value
      }
      Prop("cameraPosition") { (view: RtmpPublisherView, value: String) in
        let changed = view.cameraPosition != value
        view.cameraPosition = value
        if changed { view.updateCamera() }
      }
      // 撮影ズーム（1.0 = 等倍）。端末の上限は View 側で丸めるので JS は上限を知らなくてよい。
      Prop("zoom") { (view: RtmpPublisherView, value: Double) in
        let changed = view.zoom != value
        view.zoom = value
        if changed { view.applyZoom() }
      }
      // 配信前の映像チェックの厳格度（"off" | "warn" | "block"）。既定は warn＝止めない。
      // ★active より前に届く保証はないが、reconcile は active/streamUrl のセッタでしか
      //   走らないため、実際には「全 Prop 適用後」に近いタイミングで参照される。
      Prop("preflightMode") { (view: RtmpPublisherView, value: String?) in
        view.preflightMode = value ?? "warn"
      }
      Prop("scoreboardText") { (view: RtmpPublisherView, value: String?) in
        view.scoreboardText = value ?? ""
        view.applyScoreboard()
      }
      Prop("scoreboardVisible") { (view: RtmpPublisherView, value: Bool) in
        view.scoreboardVisible = value
        view.applyScoreboard()
      }
    }
  }
}

/// AVAuthorizationStatus を JS 側の3値（granted / denied / undetermined）に落とす。
/// Android 版と同じ語彙にしてあるので、JS は OS を意識せず同じ分岐で扱える。
private func rtmpAuthLabel(_ status: AVAuthorizationStatus) -> String {
  switch status {
  case .authorized: return "granted"
  case .denied, .restricted: return "denied"
  case .notDetermined: return "undetermined"
  @unknown default: return "undetermined"
  }
}
