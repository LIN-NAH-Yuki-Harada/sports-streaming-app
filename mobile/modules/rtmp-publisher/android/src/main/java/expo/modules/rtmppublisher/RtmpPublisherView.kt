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
import android.os.SystemClock
import android.util.Log
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
import com.pedro.library.util.streamclient.StreamBaseClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

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

  // prepareVideo に実際に渡した fps（送信キュー上限の算出に使う。Prop の既定 60 ではなく実値）。
  private var preparedFps = 30
  // 実際に適用できた送信キュー上限（0 = 適用できずライブラリ既定 400 のまま）。診断用。
  private var appliedSendCacheItems = 0
  // 配信中に観測したキュー滞留の最大値と、統計ログの間引き用タイムスタンプ。
  private var peakItemsInCache = 0
  private var lastStatsLogMs = 0L

  private val audioBitrate = 128_000

  // ---- アダプティブビットレートの状態（すべて「映像+音声の合計 bps」で持つ）--------------
  // ライブラリの BitrateAdapter は使わない（理由は adaptBitrate のコメント参照）。
  /** 上限＝prepare 時に確定する videoBitrate + audioBitrate。0 = 未 prepare。 */
  private var maxTotalBitrate = 0
  /** 今の目標値。混雑で下げ、平穏が続けば上げる。 */
  private var targetTotalBitrate = 0
  /** 実際にエンコーダへ渡した値（0 = 未適用。配信開始直後に必ず上限を1回適用するため）。 */
  private var appliedTotalBitrate = 0
  /** 混雑を検知しなかった連続秒数（上げる判断に使う）。 */
  private var calmTicks = 0
  /** 直前 tick までの累計ドロップ数（この1秒で増えたか＝実際にコマを捨てたかの判定に使う）。 */
  private var lastDroppedFrames = 0L
  /** 診断用: 降格した回数と、配信中に到達した最低映像ビットレート。 */
  private var bitrateDownCount = 0
  private var lowestVideoBitrate = 0

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
    // ★送信キュー上限の適用は「startStream の直前・キューが空のうち」に必ず行う（下の説明参照）。
    peakItemsInCache = 0
    lastStatsLogMs = 0L
    resetBitrateAdaptation()
    applySendCache(s)
    try {
      s.startStream(url)
    } catch (e: Exception) {
      streamingRequested = false
      emit("error", e.message ?: "startStream failed")
    }
  }

  private fun stop() {
    streamingRequested = false
    val s = stream ?: return
    // 停止直前のキュー統計を控えてから止める（stopStream 後は 0 にリセットされて読めない）。
    val summary = cacheSummary(s)
    try {
      if (s.isStreaming) {
        // stopStream が false を返したらエンコーダの再利用不可＝次回 start 前に作り直す。
        if (!s.stopStream()) prepared = false
      }
    } catch (_: Exception) {
      prepared = false
    }
    resetBitrateAdaptation()
    Log.i(TAG, "stream stopped: $summary")
    // iOS の stopStreaming と同じく正常停止でも closed を通知（JS は endedRef で無視）。
    // message はキュー統計（JS 側は closed の message を参照しないので挙動は変わらない。
    // console.log 経由で logcat/Metro に残り、実機テストの合否判定に使える）。
    emit("closed", summary)
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
    cam.setCameraCallback(object : CameraCallbacks {
      override fun onCameraChanged(facing: CameraHelper.Facing) {}
      override fun onCameraOpened() {}
      override fun onCameraDisconnected() {
        // カメラスレッドから呼ばれ得るため main へ寄せてから判定。配信要求中のみ通知
        // （stop 後のプレビュー破棄等での誤 error を抑止）。
        mainHandler.post { if (streamingRequested) emit("error", "camera disconnected") }
      }
      override fun onCameraError(error: String) {
        // ★2026-08-10: 素の文字列（例 "Open camera 0 failed"）だけだと
        //   「権限が無い」のか「他がカメラを掴んでいる」のか「ライブラリと端末の相性」なのか
        //   区別できず、実機ログの取れない現場で切り分けができなかった。
        //   権限の状態を必ず添えて、画面のスクリーンショット1枚で判定できるようにする。
        val detail = "$error [cam=${permLabel(Manifest.permission.CAMERA)}" +
          " mic=${permLabel(Manifest.permission.RECORD_AUDIO)}" +
          " sdk=${Build.VERSION.SDK_INT}]"
        mainHandler.post { if (streamingRequested) emit("error", detail) }
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
      preparedFps = fpsInt // 送信キュー上限の算出に使う（Prop 既定の 60 ではなく実際に prepare した値）
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

    // アダプティブの上限＝prepare で確定した「映像+音声」の合計。以後この値を超えない。
    maxTotalBitrate = videoBitrate + audioBitrate
    resetBitrateAdaptation()
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

  // ---- 送信キュー（RootEncoder の cache）の上限 --------------------------------------
  // ★ここは「画質」ではなく「送信の待ち行列の長さ」だけを変える。解像度/ビットレート/fps/GOP
  //   には一切触れない（触れると画質が落ちるため。オーナー方針）。
  //
  // 何が起きていたか（2026-08-11 サレジオ会場・桐朋戦 66分・Android vc15）:
  //   サーバー(MediaMTX v1.17.1)が「録画の経過時間と実時間のズレが5秒を超えた」として
  //   録画を強制リセットするログを 136 回出し、録画が 131 本に分割、合計 6.7 分の映像が欠落。
  //   1回のリセットで約3秒失う（再開待ち2秒 + GOP2秒でキーフレーム待ち平均1秒）ため
  //   136 回 × 3秒 = 6.8分 で実測の欠落 6.7 分とほぼ一致する。
  //   同じ会場・同じ時間帯に配信した iOS(1.1.4) は録画1本・欠落なし＝Android 固有。
  //   ※ズレの閾値 5 秒は MediaMTX にハードコードで、サーバー設定では変えられない。
  //
  // なぜ Android だけか（RootEncoder 2.6.7 の実装）:
  //   BaseSender の送信キューは既定 400 個（common/base/BaseSender.kt: cacheSize = 400）。
  //   本アプリの構成では 1 秒あたりに積まれるフレーム数が
  //     映像 30 個(30fps) ＋ 音声 46.875 個(48000Hz ÷ AAC-LC 1024サンプル/フレーム)
  //     = 76.875 個/秒
  //   なので 400 ÷ 76.875 ≒ 5.2 秒ぶん溜め込める。回線が詰まるとこの行列が伸び、
  //   サーバーには最大 5.2 秒遅れて届く ＝ 閾値 5 秒を超える。5.2 秒 vs 5 秒の紙一重。
  //
  // 対策（vc16 / 2026-08-11）:
  //   キュー上限を「約 1.5 秒ぶん」に縮めた。結果、録画リセットは 136 回 → 39 回（-61%）、
  //   欠落 10.1% → 5.8% と改善した。
  //
  // ★しかし vc16 では「ライブがプツプツ切れる」という新しい問題が出た（2026-08-12 実戦報告）。
  //   理由はキューを縮めたこと自体ではなく、**ビットレートを下げる判断が遅すぎた**こと:
  //   ライブラリの BitrateAdapter は内部に「5 回に 1 回だけ判断する」カウンタを持つ
  //   （onNewBitrate は毎秒なので実質 5 秒に 1 回）。
  //   キューは 1.5 秒で満杯になるのに降格は最大 5 秒後 ＝ その間ずっとコマを捨て続ける。
  //   捨てたコマはライブ視聴でそのままカクつきとして見える。
  //   → 対策は「キューをさらに縮める」ではなく「反応を速くする」。本コミットの主眼。
  //
  // 今回（vc17）の設計:
  //   1) キュー上限を 1.5 秒 → 2.5 秒に**戻す方向で緩める**。
  //      MediaMTX の閾値 5 秒に対して 2.5 秒＝ちょうど 2 倍の余裕があり、録画リセットは
  //      引き続き起きない。緩めたぶん「コマを捨てるまでの猶予」が 1.7 倍になる。
  //   2) ビットレートの判断を**毎秒**に変える（下は即時・上はゆっくり）。adaptBitrate 参照。
  //   3) 混雑とみなす滞留を 1.0 秒 → 0.7 秒に早める（congestionItems 参照）。
  //   画質（解像度 / 上限ビットレート / fps / GOP / 音声）は一切変更していない。

  /**
   * 1 秒あたりに送信キューへ積まれるメディアフレーム数。
   * 映像 fps ＋ 音声フレーム/秒(48000 ÷ 1024 = 46.875)。本番設定(fps=30) では 76.875 個/秒。
   * ★キュー関連のしきい値はすべて「秒」で定義し、この値で個数へ換算する（単位を1本化）。
   */
  private fun framesPerSecond(): Double =
    preparedFps + AUDIO_SAMPLE_RATE.toDouble() / AAC_SAMPLES_PER_FRAME

  /**
   * 送信キューに積んでよいメディアフレーム数（＝上限）。
   * 本番設定(fps=30) では 76.875 × 2.5 秒 = 192.2 → 192 個（= 2.50 秒ぶん）。
   */
  private fun sendCacheItems(): Int =
    (framesPerSecond() * SEND_CACHE_SECONDS).roundToInt()
      .coerceIn(SEND_CACHE_MIN_ITEMS, SEND_CACHE_MAX_ITEMS)

  /**
   * 送信キュー上限を適用する。
   * ★呼ぶ場所が重要: resizeCache は「今キューに入っている量より小さいサイズ」を要求すると
   *   RuntimeException を投げる（BaseSender.resizeCache のガード）。したがって必ず
   *   startStream の前＝送信が始まっておらずキューが空のうちに呼ぶ。
   *   （BaseSender.start() が queue.clear() するので、停止中のキューは空。
   *     縮めたキュー自体は RtmpClient が持つ sender に残るので、再接続時も維持される）
   * ★失敗しても配信は止めない。ライブラリ既定 400 のままでも配信自体は成立する。
   */
  private fun applySendCache(s: RtmpStream) {
    if (s.isStreaming) return // 送信中は実データが入っており縮小できない（例外になる）
    val items = sendCacheItems()
    appliedSendCacheItems = try {
      s.getStreamClient().resizeCache(items)
      Log.i(
        TAG,
        "send cache resized: $items items" +
          " (~${SEND_CACHE_SECONDS}s at ${preparedFps}fps + ${AUDIO_SAMPLE_RATE}Hz audio," +
          " congestion trigger=${congestionItems()} items ~${CONGESTION_TRIGGER_SECONDS}s," +
          " library default 400 = ~5.2s)",
      )
      items
    } catch (e: Exception) {
      Log.w(TAG, "send cache resize failed, keep library default 400: ${e.message}")
      0
    }
  }

  /**
   * 「混雑」とみなす滞留フレーム数。CONGESTION_TRIGGER_SECONDS を個数へ換算する。
   * 本番設定(fps=30) では 76.875 × 0.7 = 53.8 → 54 個（= 0.70 秒ぶんの遅れ）。
   *
   * ★秒→個数で自前に判定する理由: ライブラリの hasCongestion(percent) は
   *   「今のキュー容量に対する割合」なので、上限を変えるたびに % を計算し直す必要があり、
   *   さらに resizeCache に失敗した場合（上限 400 のまま）は同じ % が別の実時間を意味してしまう。
   *   個数で持てば、上限がいくつでも「0.7 秒の遅れ」という意味が変わらない。
   *   （hasCongestion は queue の実サイズを見るので、resize 成功時は本実装と等価）
   *
   * ★1.0 秒 → 0.7 秒に早めた理由: 混雑を検知してから実際にビットレートが下がって
   *   キューが減り始めるまでには必ず数百 ms の遅れがある。0.7 秒で気づけば、上限 2.5 秒まで
   *   1.8 秒ぶんの猶予を残して手を打てる（従来は 1.0 秒検知＋最大 5 秒待ちで完全に間に合わなかった）。
   *   誤検知の余地も十分ある: GOP 2 秒のキーフレームは平均フレームの約 5 倍＝約 0.58Mbit で、
   *   3.5Mbps の回線なら送出に約 0.17 秒。0.7 秒はその 4 倍で、通常のキーフレーム送出では届かない。
   */
  private fun congestionItems(): Int =
    (framesPerSecond() * CONGESTION_TRIGGER_SECONDS).roundToInt().coerceAtLeast(1)

  /**
   * 「キューが捌けている」とみなす滞留フレーム数（ビットレートを上げてよい条件）。
   * 本番設定(fps=30) では 76.875 × 0.3 = 23.1 → 23 個（= 0.30 秒）。
   * ★混雑していない（0.7 秒未満）だけでは上げない。0.5 秒前後で張り付いている状態は
   *   「回線の限界ちょうど」であり、そこで上げれば必ず混雑に戻るため。
   */
  private fun recoveryItems(): Int =
    (framesPerSecond() * RECOVERY_QUEUE_SECONDS).roundToInt().coerceAtLeast(1)

  /** 配信開始/停止時にアダプティブの状態を初期化する（次の配信を上限から始めるため）。 */
  private fun resetBitrateAdaptation() {
    targetTotalBitrate = maxTotalBitrate
    appliedTotalBitrate = 0 // 0 = 未適用。配信開始後の最初の tick で必ず上限を適用し直す
    calmTicks = 0
    lastDroppedFrames = 0L
    bitrateDownCount = 0
    lowestVideoBitrate = 0
  }

  /**
   * ★毎秒のビットレート適応（本コミットの中核）。onNewBitrate から毎秒呼ばれる。
   *
   * なぜライブラリの BitrateAdapter をやめたか:
   *   BitrateAdapter は内部に cont カウンタを持ち `if (cont >= 5)` でしか判断しない。
   *   onNewBitrate は毎秒なので実質 5 秒に 1 回。この 5 秒はライブラリ内部の定数で
   *   外から変更できない。キューが 1.5〜2.5 秒で満杯になる本アプリでは、
   *   「満杯 → コマ落ち → ライブがカクつく」が最大 5 秒続いてしまう。
   *
   * 設計（非対称にするのが要点）:
   *   下げる = 混雑を検知したその秒に即座に。実効スループット(measured)は回線の実力そのものなので、
   *            その 0.8 倍を狙えば 1〜2 秒で回線の下に潜り込める。
   *   上げる = 混雑が RECOVERY_CALM_TICKS 秒（3 秒）続けて無く、かつキューが捌けている時だけ
   *            1 段（+15%）。急に戻すと再び混雑してカクつきが再発するため。
   *   ※ 下げ遅れ＝コマ落ち（ライブのカクつき）、上げ急ぎ＝再混雑。だから非対称にする。
   *
   * @param measuredTotalBps ライブラリ実測の送信スループット（映像+音声の合計）
   * @param items 今キューに溜まっているフレーム数
   * @param droppedDelta この 1 秒で新たに捨てたフレーム数
   * @return 混雑と判定したか（ログ用）
   */
  private fun adaptBitrate(
    s: RtmpStream,
    measuredTotalBps: Long,
    items: Int,
    droppedDelta: Long,
  ): Boolean {
    // 実際にコマを捨てた ＝ 疑いようのない混雑。1 秒に 1 回のサンプリングでは
    // キューが溜まって捌けた瞬間を取りこぼすことがあるため、この signal も併用する。
    val congested = items >= congestionItems() || droppedDelta > 0
    if (maxTotalBitrate <= 0) return congested

    val minTotal = MIN_VIDEO_BITRATE + audioBitrate
    var next = targetTotalBitrate
    if (congested) {
      calmTicks = 0
      // 実測が今の目標を上回ることがある（キューを吐き出している最中など）ので下限側で採用。
      val base = minOf(measuredTotalBps.toDouble(), targetTotalBitrate.toDouble())
      // ★1 tick の下げ幅には床を設ける。回線の瞬断（4G のハンドオーバ等）で measured が
      //   一瞬ゼロ近くまで落ちると、それを回線の実力と誤認して 500kbps まで落ち、
      //   戻すのに数十秒かかってしまう。半分までに留めれば最悪でも 2 tick で追従できる。
      val floor = targetTotalBitrate * BITRATE_MAX_DROP_PER_TICK
      next = maxOf(base * BITRATE_DECREASE_FACTOR, floor).roundToInt()
      if (next > targetTotalBitrate) next = targetTotalBitrate // 下げる判断で上げない
    } else {
      calmTicks++
      val canIncrease = targetTotalBitrate < maxTotalBitrate &&
        calmTicks >= RECOVERY_CALM_TICKS &&
        items <= recoveryItems()
      if (canIncrease) {
        // ★上げ幅の基準は「実測」ではなく「今の目標」。動きの少ない場面では実測が目標を
        //   大きく下回る（＝正常）ため、実測基準だと上げたつもりで下がり、二度と戻らない。
        next = (targetTotalBitrate * BITRATE_INCREASE_FACTOR).roundToInt()
        calmTicks = 0
      }
    }

    // coerceIn は「下限 > 上限」で例外を投げる。videoBitrate Prop が下限クランプより小さい
    // 構成（将来の設定ミス）でも配信を止めないよう、下限は上限を超えないようにしてから使う。
    val lower = minOf(minTotal, maxTotalBitrate)
    val clamped = next.coerceIn(lower, maxTotalBitrate)
    if (clamped < targetTotalBitrate) bitrateDownCount++
    targetTotalBitrate = clamped
    // appliedTotalBitrate が 0（配信開始直後）のときは、目標と同じでも必ず 1 回適用する。
    // 同一 View で stop → start した場合、エンコーダには前回の降格値が残っているため。
    if (targetTotalBitrate != appliedTotalBitrate) {
      val video = (targetTotalBitrate - audioBitrate).coerceAtLeast(MIN_VIDEO_BITRATE)
      try {
        s.setVideoBitrateOnFly(video)
        appliedTotalBitrate = targetTotalBitrate
        if (lowestVideoBitrate == 0 || video < lowestVideoBitrate) lowestVideoBitrate = video
      } catch (_: Exception) {
        // 適用に失敗しても配信は続ける（次の tick で再試行される）。
      }
    }
    return congested
  }

  /** 実機テストの合否判定に使う統計（1行）。重い処理は含めない。 */
  private fun cacheSummary(s: RtmpStream): String = try {
    val client = s.getStreamClient()
    val limit = if (appliedSendCacheItems > 0) appliedSendCacheItems.toString() else "400(default)"
    "cacheLimit=$limit peakItems=$peakItemsInCache" +
      " droppedVideo=${client.getDroppedVideoFrames()} droppedAudio=${client.getDroppedAudioFrames()}" +
      " bitrateDown=$bitrateDownCount lowestVideoKbps=${lowestVideoBitrate / 1000}"
  } catch (_: Exception) {
    "cacheLimit=? peakItems=$peakItemsInCache bitrateDown=$bitrateDownCount"
  }

  /**
   * 診断ログ（1 秒に 1 行）。次のテストで原因が分からなくならないよう、
   * 「キュー滞留・現在ビットレート・混雑判定・コマ落ち累計」を必ず 1 行に含める。
   * ※ getCacheSize() はライブラリ側が resizeCache 後も 400 を返す実装（BaseSender の
   *   cacheSize フィールドが更新されない）ため使わない。実測は getItemsInCache() のみ。
   */
  private fun logStats(
    items: Int,
    congested: Boolean,
    measuredTotalBps: Long,
    droppedTotal: Long,
    droppedDelta: Long,
  ) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastStatsLogMs < STATS_LOG_INTERVAL_MS) return
    lastStatsLogMs = now
    Log.i(
      TAG,
      "adapt items=$items/${if (appliedSendCacheItems > 0) appliedSendCacheItems else 400}" +
        "(peak=$peakItemsInCache trigger=${congestionItems()})" +
        " congested=$congested measuredKbps=${measuredTotalBps / 1000}" +
        " videoKbps=${(targetTotalBitrate - audioBitrate) / 1000}/${videoBitrate / 1000}" +
        " dropped=$droppedTotal(+$droppedDelta) down=$bitrateDownCount calm=$calmTicks",
    )
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
    val s = stream
    val summary = if (s != null) cacheSummary(s) else "cacheLimit=? peakItems=$peakItemsInCache"
    Log.i(TAG, "disconnected: $summary")
    emit("closed", summary)
  }

  override fun onAuthError() {
    emit("error", "auth error")
  }

  override fun onAuthSuccess() {}

  // BitrateChecker: 送信実測ビットレート（映像+音声合計）。ライブラリが約1秒ごとに呼ぶ。
  // 呼び出しスレッド保証がないためメインスレッドへ寄せてから適応させる（公式デモと同じ構成）。
  // ★ここが「毎秒の判断」の唯一の入口。間引かない（間引くと反応が遅れ、vc16 の再現になる）。
  override fun onNewBitrate(bitrate: Long) {
    mainHandler.post {
      val s = stream ?: return@post
      if (!s.isStreaming) return@post
      val client: StreamBaseClient = try { s.getStreamClient() } catch (_: Exception) { return@post }
      try {
        val items = client.getItemsInCache()
        if (items > peakItemsInCache) peakItemsInCache = items
        val droppedTotal = client.getDroppedVideoFrames().toLong() +
          client.getDroppedAudioFrames().toLong()
        // 再接続でカウンタが 0 に戻る可能性があるため負の差分は 0 とみなす。
        val droppedDelta = (droppedTotal - lastDroppedFrames).coerceAtLeast(0L)
        lastDroppedFrames = droppedTotal
        val congested = adaptBitrate(s, bitrate, items, droppedDelta)
        // 診断はビットレート適応の後（ログで例外が出ても適応を止めない）。
        try { logStats(items, congested, bitrate, droppedTotal, droppedDelta) } catch (_: Exception) {}
      } catch (_: Exception) {}
    }
  }

  /** 権限の状態を短い文字列で返す（エラー表示に添えて現場で切り分けるため）。 */
  private fun permLabel(permission: String): String =
    if (context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) "ok" else "NG"

  companion object {
    private const val TAG = "RtmpPublisher"

    // アダプティブ降格の下限（これ未満は映像が用をなさないため足切り）。★変更しないこと。
    private const val MIN_VIDEO_BITRATE = 500_000

    // ---- 調整するならここだけ（すべて「秒」または「倍率」。個数は自動計算される） ----
    // ★env ではなく定数にしている理由: このアプリは OTA 更新(expo-updates)を持たないため
    //   env にしても値の変更＝再ビルドで手間は同じ。定数1つの方が誤設定の余地がない。
    //
    // 送信キューに溜めてよい時間。サーバー(MediaMTX)は「5 秒」以上の遅れで録画を切り直す。
    //   2.5 秒＝閾値のちょうど半分。1.5 秒（vc16）より猶予が 1.7 倍あり、
    //   同じ混雑でもコマを捨て始めるまでが長い＝ライブがカクつきにくい。
    //   3.0 秒を超えると MediaMTX 閾値までの余裕が 2 秒を切るので上げない。
    private const val SEND_CACHE_SECONDS = 2.5
    // 「混雑」とみなす滞留時間。0.7 秒 ＝ 上限 2.5 秒に対し 1.8 秒の対処猶予を残す。
    //   下げすぎる（0.3 秒未満）とキーフレーム送出の一瞬の詰まりで誤検知し、画質が無駄に落ちる。
    private const val CONGESTION_TRIGGER_SECONDS = 0.7
    // ビットレートを上げてよい「キューが捌けている」滞留時間。0.3 秒。
    private const val RECOVERY_QUEUE_SECONDS = 0.3

    // ---- ビットレート適応（下は即座に・上はゆっくり） ----
    // 混雑時の目標＝実効スループットの 0.8 倍（ライブラリ既定 decreaseRange と同値）。
    private const val BITRATE_DECREASE_FACTOR = 0.8
    // 1 tick（1 秒）で下げてよい最大幅。0.5 = 半分まで。瞬断による過剰降格の保険。
    private const val BITRATE_MAX_DROP_PER_TICK = 0.5
    // 復帰時の 1 段の上げ幅（+15%）。ライブラリ既定の 1.2 より控えめ＝再混雑しにくい。
    private const val BITRATE_INCREASE_FACTOR = 1.15
    // 上げるまでに必要な「混雑なし」の連続 tick 数（onNewBitrate は毎秒 ＝ 3 秒）。
    private const val RECOVERY_CALM_TICKS = 3
    // prepareAudio(48_000, ...) と一致させること（音声フレーム/秒の算出に使う）。
    private const val AUDIO_SAMPLE_RATE = 48_000
    // AAC-LC は 1 フレーム = 1024 サンプル固定（48000 ÷ 1024 = 46.875 フレーム/秒）。
    private const val AAC_SAMPLES_PER_FRAME = 1024
    // 下限/上限のクランプ。上限はライブラリ既定＝これ以上は広げない（広げても意味がない）。
    private const val SEND_CACHE_MIN_ITEMS = 60
    private const val SEND_CACHE_MAX_ITEMS = 400
    // 診断ログの二重出力よけ。onNewBitrate 自体が約1秒周期なので通常は毎回通る。
    // ★1000 だと呼び出しの揺らぎ（999ms 等）で1行おきに落ちるため 900 にしている。
    private const val STATS_LOG_INTERVAL_MS = 900L
  }
}
