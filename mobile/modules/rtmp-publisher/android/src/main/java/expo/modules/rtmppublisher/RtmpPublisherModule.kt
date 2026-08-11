package expo.modules.rtmppublisher

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// iOS 版 (ios/RtmpPublisherModule.swift) と同一の Prop/Event 契約。
// Prop セッタは値の保存のみ行い、全 Prop 適用後に必ず1回発火する
// OnViewDidUpdateProps で reconcile する（Android は Prop 適用順が不定のため、
// iOS の「セッタごとに reconcile」ではなくトランザクション末尾で1回が正しい）。
class RtmpPublisherModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RtmpPublisher")

    View(RtmpPublisherView::class) {
      Events("onStatus")

      Prop("streamUrl") { view: RtmpPublisherView, value: String? ->
        view.streamUrl = value
      }
      Prop("active") { view: RtmpPublisherView, value: Boolean ->
        view.active = value
      }
      Prop("videoWidth") { view: RtmpPublisherView, value: Int ->
        view.videoWidth = value
      }
      Prop("videoHeight") { view: RtmpPublisherView, value: Int ->
        view.videoHeight = value
      }
      Prop("videoBitrate") { view: RtmpPublisherView, value: Int ->
        view.videoBitrate = value
      }
      Prop("fps") { view: RtmpPublisherView, value: Double ->
        view.fps = value
      }
      Prop("cameraPosition") { view: RtmpPublisherView, value: String ->
        view.cameraPosition = value
      }
      Prop("scoreboardText") { view: RtmpPublisherView, value: String? ->
        view.scoreboardText = value ?: ""
      }
      Prop("scoreboardVisible") { view: RtmpPublisherView, value: Boolean ->
        view.scoreboardVisible = value
      }

      OnViewDidUpdateProps { view: RtmpPublisherView ->
        view.onPropsUpdated()
      }

      OnViewDestroys { view: RtmpPublisherView ->
        view.cleanup()
      }
    }
  }
}
