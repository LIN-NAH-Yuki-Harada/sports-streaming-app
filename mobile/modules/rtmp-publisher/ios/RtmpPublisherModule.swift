import ExpoModulesCore

public class RtmpPublisherModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RtmpPublisher")

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
