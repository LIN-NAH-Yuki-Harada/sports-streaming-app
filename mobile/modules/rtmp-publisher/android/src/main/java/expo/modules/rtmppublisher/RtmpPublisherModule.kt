package expo.modules.rtmppublisher

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// iOS 版 (ios/RtmpPublisherModule.swift) と同一の Prop/Event 契約。
// Prop セッタは値の保存のみ行い、全 Prop 適用後に必ず1回発火する
// OnViewDidUpdateProps で reconcile する（Android は Prop 適用順が不定のため、
// iOS の「セッタごとに reconcile」ではなくトランザクション末尾で1回が正しい）。
class RtmpPublisherModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RtmpPublisher")

    // ───────── 配信前チェック用の API（iOS 版と同一契約）─────────
    // 戻り値: { camera: "granted"|"denied"|"undetermined", mic: 同じ }
    //
    // ★Android の「要求」（許可ダイアログ表示）は Activity が要るため JS 側の
    //   PermissionsAndroid が行う（vc15 で実戦稼働済みの経路をそのまま使う）。
    //   ここは**状態の読み取り専用**。requestDevicePermissions も現在値を返すだけで、
    //   iOS と同じ形の戻り値にすることで JS 側の分岐を1本にする。
    AsyncFunction("getDeviceStatus") {
      currentStatus()
    }

    AsyncFunction("requestDevicePermissions") {
      currentStatus()
    }

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
      // 撮影ズーム（1.0 = 等倍）。端末の上限は View 側で丸める（iOS と同一契約）。
      Prop("zoom") { view: RtmpPublisherView, value: Double ->
        view.zoom = value
      }
      // 配信前の映像チェックの厳格度（"off" | "warn" | "block"）。既定 warn＝止めない。
      Prop("preflightMode") { view: RtmpPublisherView, value: String? ->
        view.preflightMode = value ?: "warn"
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

  /** カメラ／マイクの許可状態を iOS と同じ語彙で返す。 */
  private fun currentStatus(): Map<String, String> {
    val ctx = appContext.reactContext
      ?: return mapOf("camera" to "undetermined", "mic" to "undetermined")
    return mapOf(
      "camera" to permState(ctx, Manifest.permission.CAMERA),
      "mic" to permState(ctx, Manifest.permission.RECORD_AUDIO),
    )
  }

  // ★Android は「まだ聞いていない」と「拒否された」を Context からは区別できない。
  //   区別が要るのは JS 側（shouldShowRequestPermissionRationale を持つ PermissionsAndroid）なので、
  //   ここでは granted / undetermined の2値に寄せる。undetermined を返せば JS は必ず
  //   PermissionsAndroid で要求しに行く＝一番安全側（迷ったら聞く）に倒れる。
  private fun permState(ctx: Context, permission: String): String =
    if (ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
      "granted"
    } else {
      "undetermined"
    }
}
