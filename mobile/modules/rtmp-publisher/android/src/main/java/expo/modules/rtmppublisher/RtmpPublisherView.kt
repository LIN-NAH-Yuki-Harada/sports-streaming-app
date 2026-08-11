package expo.modules.rtmppublisher

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.hardware.display.DisplayManager
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.gl.render.filters.`object`.TextObjectFilterRender
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.encoder.input.video.CameraCallbacks
import com.pedro.encoder.input.video.CameraHelper
import com.pedro.encoder.utils.gl.TranslateTo
import com.pedro.library.rtmp.RtmpStream
import com.pedro.library.util.BitrateAdapter
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// カメラ＋マイクを RTMP(TCP/バッファ型) で push する Expo ネイティブ View（Android 版）。
// iOS 版 (ios/RtmpPublisherView.swift) と同一の Prop/Event 契約:
//   - streamUrl + active の2Propで開始/停止（命令的メソッドなし）
//   - onStatus: connecting / open / closing / closed / error
//     ※ interrupted / resumed は iOS の AVCaptureSession 中断固有のため Android では送らない。
//       JS 側は open/error/closed だけで再接続（remount）が成立する設計。
//   - 出力は常に 1280x720 横固定。端末回転は landscapeLeft/Right のみ追従し、縦持ちは
//     無視して直近の横を維持（iOS と同一仕様）。
//   - 再接続はネイティブで自前リトライしない（JS 側が View remount で同一 URL へ再 publish）。
// 実装は RootEncoder 2.6.7（Camera2Source + MicrophoneSource + RtmpStream/StreamBase）。
// バージョンは build.gradle のコメント参照（Kotlin metadata 互換とカメラフリーズ既知バグの
// 二重制約で 2.6.7 固定。安易に変更しない）。
class RtmpPublisherView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), ConnectChecker {

  // Props（RtmpPublisherModule のセッタが書き込む。適用は onPropsUpdated で一括）
  var streamUrl: String? = null
  var active: Boolean = false
  var videoWidth: Int = 1280
  var videoHeight: Int = 720
  var videoBitrate: Int = 6_000_000
  var fps: Double = 60.0
  var cameraPosition: String = "back"
  var scoreboardText: String = ""
  var scoreboardVisible: Boolean = true

  // 配信前の映像チェックの厳格度（iOS と同一契約）。既定 "warn" ＝**絶対に配信を止めない**。
  //   "off"   … 何もしない（緊急時の全停止スイッチ）
  //   "warn"  … カメラが開けていなくても配信は開始し、JS へ novideo を通知して警告表示だけ出す
  //   "block" … カメラが開けていなければ startStream しない（既定では使わない）
  var preflightMode: String = "warn"

  private val onStatus by EventDispatcher()
  private val mainHandler = Handler(Looper.getMainLooper())

  private val surfaceView = SurfaceView(context)
  private var stream: RtmpStream? = null
  private var camera: Camera2Source? = null
  private var prepared = false
  // 「配信を要求済み」フラグ。接続エラーでは倒さない（iOS の isStreaming と同じ意味論:
  // エラー後に Prop 更新が来ても勝手に再 start せず、JS の remount 判断に委ねる）。
  private var streamingRequested = false
  private var surfaceReady = false
  private var destroyed = false
  private var appliedOrientation = 270 // prepareVideo(rotation=0) の初期向き＝通常 landscape
  private var textFilter: TextObjectFilterRender? = null
  private var appliedScoreboardKey: String? = null

  // ★カメラが「実際に開いた」か（CameraDevice.StateCallback.onOpened 由来）。
  //   権限が下りていても、他アプリが掴んでいる/端末の相性 等で開かないことがある。
  //   実データ（2026-08-12）では、権限とは無関係に音声だけが publish された配信が
  //   3回確認されている。「接続できた」は「映っている」の証明にならない。
  private var cameraOpened = false
  // 直近に novideo を通知済みか（同じ警告を連投しないための1回きりガード）
  private var noVideoNotified = false
  // 配信開始（startStream 呼び出し）時刻。ビットレート監視の助走に使う。
  private var streamStartedAt = 0L
  // 映像なしが疑われる状態が続いた秒数（onNewBitrate は毎秒来る）
  private var lowBitrateSeconds = 0

  private val audioBitrate = 128_000

  // アダプティブビットレート（4G の要): 上り実効スループットに応じて自動昇降。
  // 上限は setMaxBitrate（映像+音声の合計＝公式パターン）、下限は自前クランプ
  // （BitrateAdapter には下限が無く、輻輳が続くと際限なく下がるため）。
  private val bitrateAdapter = BitrateAdapter { bps ->
    stream?.setVideoBitrateOnFly(bps.coerceAtLeast(MIN_VIDEO_BITRATE))
  }

  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) {}
    override fun onDisplayRemoved(displayId: Int) {}
    override fun onDisplayChanged(displayId: Int) {
      mainHandler.post { applyLandscapeOrientation() }
    }
  }

  init {
    addView(
      surfaceView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    // プレビューは「prepare 済み かつ surface 生成済み」が揃った時点で開始する。
    // （StreamBase は prepareVideo/prepareAudio を全停止状態でしか呼べないため、
    //   Prop が届く前に surface だけ先にできてもプレビューを始めない）
    surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = true
        val s = stream ?: return
        if (prepared && !s.isOnPreview) {
          try { s.startPreview(surfaceView) } catch (_: Exception) {}
        }
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        try {
          stream?.let { it.getGlInterface().setPreviewResolution(width, height) }
        } catch (_: Exception) {}
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceReady = false
        val s = stream ?: return
        if (s.isOnPreview) {
          try { s.stopPreview() } catch (_: Exception) {}
        }
      }
    })
    (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager)
      .registerDisplayListener(displayListener, mainHandler)
  }

  // 全 Prop 適用後に1回呼ばれる（初回マウント含む）。冪等。
  fun onPropsUpdated() {
    if (destroyed) return
    reconcile()
    applyCameraFacing()
    applyScoreboard()
  }

  private fun reconcile() {
    val shouldRun = active && !streamUrl.isNullOrEmpty()
    if (shouldRun && !streamingRequested) {
      start()
    } else if (!shouldRun && streamingRequested) {
      stop()
    }
  }

  private fun start() {
    val url = streamUrl ?: return
    if (!ensureStreamPrepared()) {
      emit("error", "prepare failed (camera/mic/encoder)")
      return
    }
    val s = stream ?: return
    streamingRequested = true
    emit("connecting")
    applyLandscapeOrientation()
    applyCameraFacing()
    applyScoreboard()
    if (surfaceReady && !s.isOnPreview) {
      try { s.startPreview(surfaceView) } catch (_: Exception) {}
    }
    // ★配信前チェック: プレビューを開始できたなら、カメラが実際に開くのを待ってから publish する。
    //   プレビューを開始できていない（surface 未生成など）ときは待たない
    //   ＝ vc15 と完全に同じ挙動のまま（新しい失敗経路を作らない）。
    val previewing = try { s.isOnPreview } catch (_: Exception) { false }
    if (preflightMode == "off" || !previewing) {
      beginStream(url)
    } else {
      waitCameraThenStream(url, 0)
    }
  }

  /** カメラが開くのを待ってから publish する。上限（4秒）で必ず打ち切る。 */
  private fun waitCameraThenStream(url: String, waitedMs: Int) {
    if (destroyed || !streamingRequested) return
    if (stream == null) return
    if (!cameraOpened && waitedMs < CAMERA_OPEN_TIMEOUT_MS) {
      mainHandler.postDelayed(
        { waitCameraThenStream(url, waitedMs + CAMERA_OPEN_POLL_MS) },
        CAMERA_OPEN_POLL_MS.toLong(),
      )
      return
    }
    if (cameraOpened) {
      // カメラが開いたことを毎回はっきり通知する。JS はこれで警告表示を解除する
      // （再接続で View を作り直したときも、正常なら必ずここを通る）。
      noVideoNotified = false
      emit("media", "camera-open")
    } else {
      if (preflightMode == "block") {
        // ★このモードは既定では使わない（サーバー設定で段階的に点灯させる想定）。
        streamingRequested = false
        emit("error", "no-video: camera-open-timeout")
        return
      }
      // 既定（warn）＝**配信は必ず開始する**。画面に警告を出すだけ。
      noVideoNotified = true
      emit("novideo", "camera-open-timeout")
    }
    beginStream(url)
  }

  private fun beginStream(url: String) {
    if (destroyed || !streamingRequested) return
    val s = stream ?: return
    lowBitrateSeconds = 0
    streamStartedAt = System.currentTimeMillis()
    try {
      s.startStream(url)
    } catch (e: Exception) {
      streamingRequested = false
      emit("error", e.message ?: "startStream failed")
    }
  }

  private fun stop() {
    streamingRequested = false
    streamStartedAt = 0L
    lowBitrateSeconds = 0
    noVideoNotified = false
    val s = stream ?: return
    try {
      if (s.isStreaming) {
        // stopStream が false を返したらエンコーダの再利用不可＝次回 start 前に作り直す。
        if (!s.stopStream()) prepared = false
      }
    } catch (_: Exception) {
      prepared = false
    }
    bitrateAdapter.reset()
    emit("closed") // iOS の stopStreaming と同じく正常停止でも closed を通知（JS は endedRef で無視）
  }

  // RtmpStream を Prop 確定値で構築して prepare する。失敗時は false。
  // StreamBase は prepare をストリーム/録画/プレビュー全停止状態でしか呼べないため、
  // 初回 reconcile（Prop 確定後）のタイミングで行う。
  private fun ensureStreamPrepared(): Boolean {
    if (prepared && stream != null) return true
    // 前回の stopStream 失敗などで作り直す場合は全解放してから。
    stream?.let { old -> try { old.release() } catch (_: Exception) {} }
    stream = null
    camera = null
    textFilter = null
    appliedScoreboardKey = null

    val cam = Camera2Source(context)
    // カメラ喪失（他アプリによる奪取・Android 11+ のバックグラウンドカメラ制限等）は
    // ConnectChecker には一切通知されない。未登録のままだと RTMP 接続は生きたまま
    // フリーズ映像＋音声だけの配信が延々続くため、JS へ error を流して
    // 既存の remount 再接続ロジックに復旧を委ねる。
    cameraOpened = false
    cam.setCameraCallback(object : CameraCallbacks {
      override fun onCameraChanged(facing: CameraHelper.Facing) {}
      override fun onCameraOpened() {
        // ★CameraDevice.StateCallback.onOpened 由来＝「本当にカメラが開いた」唯一の証拠。
        //   これが来るまで startStream しないことで、映像なしの publish を防ぐ。
        mainHandler.post { cameraOpened = true }
      }
      override fun onCameraDisconnected() {
        // カメラスレッドから呼ばれ得るため main へ寄せる。
        // ★2026-08-12: 以前は `if (streamingRequested)` で握り潰していたため、
        //   prepare/preview の段階（＝配信要求前）の失敗が完全に見えなかった。
        //   まさにその段階の失敗が「音声だけの配信」を生むので、必ず外へ出す。
        mainHandler.post {
          cameraOpened = false
          emit("error", "camera disconnected")
        }
      }
      override fun onCameraError(error: String) {
        // ★2026-08-10: 素の文字列（例 "Open camera 0 failed"）だけだと
        //   「権限が無い」のか「他がカメラを掴んでいる」のか「ライブラリと端末の相性」なのか
        //   区別できず、実機ログの取れない現場で切り分けができなかった。
        //   権限の状態を必ず添えて、画面のスクリーンショット1枚で判定できるようにする。
        val detail = "$error [cam=${permLabel(Manifest.permission.CAMERA)}" +
          " mic=${permLabel(Manifest.permission.RECORD_AUDIO)}" +
          " sdk=${Build.VERSION.SDK_INT}]"
        // ★2026-08-12: `if (streamingRequested)` ガードを外した（上の onCameraDisconnected と同じ理由）。
        mainHandler.post {
          cameraOpened = false
          emit("error", detail)
        }
      }
    })
    var mic = MicrophoneSource(pickAudioSource())
    val s = RtmpStream(context, this, cam, mic)
    try {
      val fpsInt = fps.toInt().coerceAtLeast(1)
      // rotation=0 = 横 1280x720 固定出力（縦持ちでも入れ替えない）。GOP は 2 秒
      // （サーバー契約: fps30 固定・可変 fps 禁止。適応はビットレートのみ）。
      if (!s.prepareVideo(videoWidth, videoHeight, videoBitrate, fpsInt, 2, 0)) {
        try { s.release() } catch (_: Exception) {}
        return false
      }
      // 体育館スポーツ配信は OS 音声処理(AGC/NS/EC)全 OFF が正解（PR#112 の知見）。
      // echoCanceler/noiseSuppressor は既定 false、AGC は UNPROCESSED ソース指定で回避。
      var audioOk = try {
        s.prepareAudio(48_000, false, audioBitrate)
      } catch (_: Exception) {
        false
      }
      if (!audioOk && mic.audioSource != MediaRecorder.AudioSource.MIC) {
        // UNPROCESSED 宣言端末でも実際は失敗する個体があるため MIC で1回だけ再試行。
        mic = MicrophoneSource(MediaRecorder.AudioSource.MIC)
        try { s.changeAudioSource(mic) } catch (_: Exception) {}
        audioOk = try {
          s.prepareAudio(48_000, false, audioBitrate)
        } catch (_: Exception) {
          false
        }
      }
      if (!audioOk) {
        try { s.release() } catch (_: Exception) {}
        return false
      }
    } catch (_: Exception) {
      try { s.release() } catch (_: Exception) {}
      return false
    }

    bitrateAdapter.setMaxBitrate(videoBitrate + audioBitrate)
    stream = s
    camera = cam
    prepared = true
    // ★prepareVideo は内部で「端末の現在向き」から cameraOrientation を導出する
    //   （縦持ちで prepare すると縦向き描画になり、映像が横倒しで配信される）。
    //   横 1280x720 固定の基準 270（通常 landscape）を明示的に復元して、
    //   appliedOrientation キャッシュと実状態を一致させる。以後の回転補正は
    //   applyLandscapeOrientation が差分適用する。
    appliedOrientation = 270
    try { s.setOrientation(270) } catch (_: Exception) {}
    return true
  }

  // 実マイク入力を無加工で取る音源を選ぶ。UNPROCESSED(API24+・対応端末)が第一候補、
  // 非対応は MIC（VOICE_COMMUNICATION は AEC/NS が乗りコート音が消えるため使わない）。
  private fun pickAudioSource(): Int {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (am.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true") {
        return MediaRecorder.AudioSource.UNPROCESSED
      }
    }
    return MediaRecorder.AudioSource.MIC
  }

  // 端末回転を配信映像へ反映。landscape 左右のみ追従し、縦持ちは無視して直近の横を維持
  // （iOS の landscapeRotationAngle と同一仕様）。値の式はライブラリ内部
  // getUiOrientation と同じ（ROTATION_90 → 270 / ROTATION_270 → 90）。
  private fun applyLandscapeOrientation() {
    if (!prepared) return
    val s = stream ?: return
    val rotation = display?.rotation ?: return
    val target = when (rotation) {
      Surface.ROTATION_90 -> 270
      Surface.ROTATION_270 -> 90
      else -> return
    }
    if (target == appliedOrientation) return
    appliedOrientation = target
    try { s.setOrientation(target) } catch (_: Exception) {}
  }

  private fun applyCameraFacing() {
    if (!prepared) return
    val cam = camera ?: return
    val wantFront = cameraPosition == "front"
    val isFront = try {
      cam.getCameraFacing() == CameraHelper.Facing.FRONT
    } catch (_: Exception) {
      return
    }
    if (wantFront != isFront) {
      try { cam.switchCamera() } catch (_: Exception) {}
    }
  }

  // スコアボード焼き込み（iOS 同様、本番は scoreboardVisible=false で休眠。
  // 視聴側 Web CSS オーバーレイ方式が正）。表示時は GL フィルタで上部にテロップ描画。
  private fun applyScoreboard() {
    if (!prepared) return
    val s = stream ?: return
    val show = scoreboardVisible && scoreboardText.isNotEmpty()
    val key = if (show) scoreboardText else null
    if (key == appliedScoreboardKey) return
    appliedScoreboardKey = key
    val gl = try { s.getGlInterface() } catch (_: Exception) { return }
    if (!show) {
      textFilter?.let { f -> try { gl.removeFilter(f) } catch (_: Exception) {} }
      textFilter = null
      return
    }
    try {
      val filter = textFilter ?: TextObjectFilterRender().also {
        textFilter = it
        gl.addFilter(it)
      }
      // 更新は必ずフル引数 setText（addText 系はテキスト二重連結バグあり）。
      // setDefaultScale/setPosition は setText の後（テキスト Bitmap 確定後）に呼ぶ。
      // ※setScale(0f, ...) は Sprite 内部の0除算で頂点が NaN 化し何も描画されないため、
      //   テキスト実寸からストリーム比%を自動算出する setDefaultScale を使う（公式パターン）。
      filter.setText(scoreboardText, 22f, Color.WHITE, Color.argb(160, 0, 0, 0))
      filter.setDefaultScale(videoWidth, videoHeight)
      filter.setPosition(TranslateTo.TOP)
    } catch (_: Exception) {}
  }

  // OnViewDestroys（JS の unmount = 停止/再接続 remount の両方で呼ばれる）。
  // release() が stopStream/stopPreview を内包し、カメラ・マイク・GL を全解放する。
  // ここでの解放漏れは再接続時の Camera in use / エンコーダリークに直結する。
  fun cleanup() {
    destroyed = true
    streamingRequested = false
    try {
      (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager)
        .unregisterDisplayListener(displayListener)
    } catch (_: Exception) {}
    val s = stream
    stream = null
    camera = null
    textFilter = null
    prepared = false
    if (s != null) {
      try { s.release() } catch (_: Exception) {}
    }
  }

  private fun emit(state: String, message: String? = null) {
    if (destroyed) return
    mainHandler.post {
      if (destroyed) return@post
      // EventDispatcher の Map オーバーロードは Map<String, Any>（値非null）のため、
      // message=null はキー自体を省略する（JS 側契約は message?: string | null で互換）。
      val payload = mutableMapOf<String, Any>("state" to state)
      message?.let { payload["message"] = it }
      onStatus(payload)
    }
  }

  // ---- ConnectChecker（RootEncoder からの接続状態通知。接続系はメインスレッド発火）----

  override fun onConnectionStarted(url: String) {
    emit("connecting")
  }

  override fun onConnectionSuccess() {
    emit("open")
  }

  override fun onConnectionFailed(reason: String) {
    // ネイティブでは再試行しない（iOS と同じ）。JS が error を受けて
    // 「初回 open 前なら終了 / open 後なら remount 再接続」を判断する。
    // リソース解放は remount / unmount 時の cleanup() に委ねる。
    emit("error", reason)
  }

  override fun onDisconnect() {
    emit("closed")
  }

  override fun onAuthError() {
    emit("error", "auth error")
  }

  override fun onAuthSuccess() {}

  // BitrateChecker: 送信実測ビットレート（映像+音声合計）。呼び出しスレッド保証が
  // ないためメインスレッドへ寄せてから適応させる（公式デモと同じ構成）。
  override fun onNewBitrate(bitrate: Long) {
    mainHandler.post {
      val s = stream ?: return@post
      if (!s.isStreaming) return@post
      try {
        bitrateAdapter.adaptBitrate(bitrate, s.getStreamClient().hasCongestion())
      } catch (_: Exception) {}
      checkVideoAlive(bitrate)
    }
  }

  /**
   * 配信中に「映像が届いていない」ことを近似的に見張る（毎秒・警告のみ）。
   *
   * ★これは**近似指標**である。Android には iOS の FrameProbe に相当する
   *   「合成後フレームの到着」を安く数える口が無いため、送信実測ビットレートで代用している。
   *   映像トラックが本当に無ければ送信量は音声(128kbps)相当まで落ちるので、
   *   閾値をそのすぐ上に置く。逆に言えば「試合が止まって絵が動かない」だけでは
   *   ここまで落ちない（H.264 は静止画でも周期的に I フレームを送るため）。
   *
   * ★絶対に配信を止めない。20秒連続で閾値を下回ったときに JS へ通知するだけ。
   *   閾値を上げると正常な配信に赤帯が出て、配信者が驚いて自分で止めてしまう
   *   ＝人の手による配信停止事故になる。厳しくするより見逃す方を選ぶ。
   */
  private fun checkVideoAlive(bitrate: Long) {
    if (preflightMode == "off") return
    // 開始直後は助走中で低く出るため見ない。
    if (streamStartedAt == 0L ||
      System.currentTimeMillis() - streamStartedAt < NO_VIDEO_WARMUP_MS
    ) {
      return
    }
    if (bitrate < NO_VIDEO_BPS) {
      lowBitrateSeconds += 1
      if (lowBitrateSeconds >= NO_VIDEO_SECONDS && !noVideoNotified) {
        noVideoNotified = true
        emit("novideo", "low bitrate ${bitrate}bps")
      }
    } else {
      lowBitrateSeconds = 0
      if (noVideoNotified) {
        noVideoNotified = false
        emit("media", "${bitrate}bps")
      }
    }
  }

  /** 権限の状態を短い文字列で返す（エラー表示に添えて現場で切り分けるため）。 */
  private fun permLabel(permission: String): String =
    if (context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) "ok" else "NG"

  companion object {
    // アダプティブ降格の下限（これ未満は映像が用をなさないため足切り）。
    // BitrateAdapter.Listener の引数は Int(bps)。
    private const val MIN_VIDEO_BITRATE = 500_000

    // カメラが開くのを待つ上限。ここを超えたら待たずに配信を始める
    // （待たせ続ける＝試合が始まらない、が最悪の事故なので必ず打ち切る）。
    private const val CAMERA_OPEN_TIMEOUT_MS = 4_000
    private const val CAMERA_OPEN_POLL_MS = 100

    // 「映像が届いていない」と見なす送信ビットレート。音声のみ(128kbps)＋余裕。
    private const val NO_VIDEO_BPS = 180_000L
    // 上を何秒連続で下回ったら通知するか（瞬間的な落ち込みで警告を出さない）。
    private const val NO_VIDEO_SECONDS = 20
    // 配信開始直後の助走期間（この間は判定しない）。
    private const val NO_VIDEO_WARMUP_MS = 10_000L
  }
}
