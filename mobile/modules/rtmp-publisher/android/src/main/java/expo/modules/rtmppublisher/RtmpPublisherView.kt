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
import com.pedro.library.util.BitrateAdapter
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
  /** 撮影ズームの倍率（1.0 = 等倍＝これまでと同じ画角）。iOS 版と同一契約。 */
  var zoom: Double = 1.0
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
  // prepareVideo に実際に渡した fps（送信キュー上限の算出に使う。Prop の既定 60 ではなく実値）。
  private var preparedFps = 30
  // 実際に適用できた送信キュー上限（0 = 適用できずライブラリ既定 400 のまま）。診断用。
  private var appliedSendCacheItems = 0
  // 配信中に観測したキュー滞留の最大値と、統計ログの間引き用タイムスタンプ。
  private var peakItemsInCache = 0
  private var lastStatsLogMs = 0L

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
          // ★setZoom はカメラ起動後でないと効かない（Camera2Source.isRunning() ガード）。
          applyZoom()
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
    applyZoom()
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
      // ★同上。プレビュー開始のたびに当て直す。
      applyZoom()
    }
    // ★送信キュー上限の適用は「startStream の直前・キューが空のうち」に必ず行う（下の説明参照）。
    peakItemsInCache = 0
    lastStatsLogMs = 0L
    applySendCache(s)
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
    bitrateAdapter.reset()
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
  // 対策:
  //   キュー上限を「約 1.5 秒ぶん」に縮め、遅れが構造的に 5 秒へ届かないようにする。
  //   1.5 秒なら閾値まで 3.5 秒の余裕（3.3 倍のマージン）。
  //   縮めた副作用は「輻輳が 1.5 秒続くとフレームが捨てられる（＝一瞬カクつく）」だが、
  //   捨てられても接続は切れない。従来は捨てずに溜め込んだ結果サーバー側リセットを招き、
  //   3 秒の欠落＋録画分割＋スコアずれになっていたので、こちらの方が明確に軽い。

  /**
   * 送信キューに積んでよいメディアフレーム数を、実際に prepare した fps から算出する。
   * 1 秒あたりのフレーム数 = 映像 fps ＋ 音声フレーム/秒(48000 ÷ 1024 = 46.875)。
   * 本番設定(fps=30) では (30 + 46.875) × 1.5 秒 = 115.3 → 115 個。
   */
  private fun sendCacheItemsFor(fpsInt: Int): Int {
    val audioFramesPerSecond = AUDIO_SAMPLE_RATE.toDouble() / AAC_SAMPLES_PER_FRAME // 46.875
    val framesPerSecond = fpsInt + audioFramesPerSecond
    return (framesPerSecond * SEND_CACHE_SECONDS).roundToInt()
      .coerceIn(SEND_CACHE_MIN_ITEMS, SEND_CACHE_MAX_ITEMS)
  }

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
    val items = sendCacheItemsFor(preparedFps)
    appliedSendCacheItems = try {
      s.getStreamClient().resizeCache(items)
      Log.i(
        TAG,
        "send cache resized: $items items" +
          " (~${SEND_CACHE_SECONDS}s at ${preparedFps}fps + ${AUDIO_SAMPLE_RATE}Hz audio," +
          " library default 400 = ~5.2s)",
      )
      items
    } catch (e: Exception) {
      Log.w(TAG, "send cache resize failed, keep library default 400: ${e.message}")
      0
    }
  }

  /**
   * 輻輳判定のしきい値（%）。
   * ライブラリ既定は「キュー上限の 20%」。上限 400 個のときは 80 個＝約 1.04 秒の滞留で
   * 輻輳とみなしていたが、上限を 115 個に縮めると同じ 20% が 23 個＝約 0.30 秒になり、
   * キーフレーム送出の一瞬の詰まりでも輻輳と判定されてビットレートが下がりうる
   * （＝画質が落ちる。オーナー方針に反する）。
   * ★今回変えたいのは「キューの上限」だけなので、ビットレート適応が働き始める“実時間”は
   *   従来どおり約 1.0 秒の滞留に据え置く。そのために % を計算し直す。
   *   1.0 ÷ 1.5 × 100 = 66.7% → 115 個 × 66.7% ≒ 77 個 ≒ 1.0 秒。
   */
  private fun congestionPercent(): Float =
    ((CONGESTION_TRIGGER_SECONDS / SEND_CACHE_SECONDS) * 100.0).toFloat().coerceIn(1f, 100f)

  /** 実機テストの合否判定に使うキュー統計（1行）。重い処理は含めない。 */
  private fun cacheSummary(s: RtmpStream): String = try {
    val client = s.getStreamClient()
    val limit = if (appliedSendCacheItems > 0) appliedSendCacheItems.toString() else "400(default)"
    "cacheLimit=$limit peakItems=$peakItemsInCache" +
      " droppedVideo=${client.getDroppedVideoFrames()} droppedAudio=${client.getDroppedAudioFrames()}"
  } catch (_: Exception) {
    "cacheLimit=? peakItems=$peakItemsInCache"
  }

  /**
   * キュー滞留の観測。onNewBitrate（ライブラリが約1秒ごとに呼ぶ）に相乗りし、
   * さらに 1 秒未満の連続呼び出しは間引く（配信中に処理を増やさないため）。
   * ※ getCacheSize() はライブラリ側が resizeCache 後も 400 を返す実装（BaseSender の
   *   cacheSize フィールドが更新されない）ため使わない。実測は getItemsInCache() のみ。
   */
  private fun observeCache(client: StreamBaseClient) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastStatsLogMs < STATS_LOG_INTERVAL_MS) return
    lastStatsLogMs = now
    val items = client.getItemsInCache()
    if (items > peakItemsInCache) peakItemsInCache = items
    Log.i(TAG, "cache items=$items peak=$peakItemsInCache limit=$appliedSendCacheItems")
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

  /**
   * 現在のカメラへズーム倍率を反映する。
   *
   * ★これは**デジタルズーム**（広角の中央を切り出して拡大）。光学ズームではないため
   *   倍率を上げるほど解像感は落ちる。配信は 1280x720 なので 2 倍で実質 640x360 相当。
   *
   * ★RootEncoder の Camera2Source.setZoom は `isRunning()`（＝カメラ起動後）でないと
   *   何もしない。したがってプレビュー開始の**後**にも必ず呼ぶこと。起動前に呼んでも
   *   無害な no-op なので、呼びすぎる分には問題ない。
   *
   * 端末が対応する範囲は getZoomRange() で丸める（iOS と同じく JS に上限を返さない）。
   */
  private fun applyZoom() {
    val cam = camera ?: return
    try {
      val range = cam.getZoomRange()
      val lo = range.lower ?: 1f
      val hi = minOf(range.upper ?: 1f, ZOOM_CAP)
      cam.setZoom(zoom.toFloat().coerceIn(lo, maxOf(lo, hi)))
    } catch (_: Exception) {
      // ズームに失敗しても配信は続ける。
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

  // BitrateChecker: 送信実測ビットレート（映像+音声合計）。呼び出しスレッド保証が
  // ないためメインスレッドへ寄せてから適応させる（公式デモと同じ構成）。
  override fun onNewBitrate(bitrate: Long) {
    mainHandler.post {
      val s = stream ?: return@post
      if (!s.isStreaming) return@post
      val client = try { s.getStreamClient() } catch (_: Exception) { return@post }
      try {
        // キュー上限を縮められた場合だけ % を読み替える（縮小に失敗＝既定 400 のままなら
        // ライブラリ既定の 20% をそのまま使う。どちらでも実時間の判定基準は約 1.0 秒）。
        val congested =
          if (appliedSendCacheItems > 0) client.hasCongestion(congestionPercent())
          else client.hasCongestion()
        bitrateAdapter.adaptBitrate(bitrate, congested)
      } catch (_: Exception) {}
      // 診断はビットレート適応の後（統計で例外が出ても適応を止めない）。
      try { observeCache(client) } catch (_: Exception) {}
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
    /** ズームの上限。720p では倍率を上げすぎても破綻するだけなので実用範囲で頭打ちにする（iOS と同値）。 */
    private const val ZOOM_CAP = 5.0f
    private const val TAG = "RtmpPublisher"

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
    // ---- 送信キュー上限のパラメータ（値を調整するならここだけ） ----
    // ★調整する場合は SEND_CACHE_SECONDS だけを 1.0〜2.0 の範囲で書き換える。
    //   小さすぎる（1.0秒未満）と輻輳時のコマ落ちが増えて映像がカクつき、
    //   大きすぎる（2.0秒超）とサーバー(MediaMTX)のズレ閾値5秒に対する余裕が減る。
    //   1.5 秒は「カクつきを増やさない下限側の余裕」と「閾値まで3.5秒のマージン」の両立点。
    // ★env ではなく定数にしている理由: このアプリは OTA 更新(expo-updates)を持たないため
    //   env にしても値の変更＝再ビルドで手間は同じ。定数1つの方が誤設定の余地がない。
    private const val SEND_CACHE_SECONDS = 1.5
    // ビットレート適応が「輻輳」とみなし始める滞留時間。ライブラリ既定（上限400個の20%＝
    // 80個＝約1.04秒）と実時間で揃えるための値。キュー上限を変えても適応の挙動を変えない。
    private const val CONGESTION_TRIGGER_SECONDS = 1.0
    // prepareAudio(48_000, ...) と一致させること（音声フレーム/秒の算出に使う）。
    private const val AUDIO_SAMPLE_RATE = 48_000
    // AAC-LC は 1 フレーム = 1024 サンプル固定（48000 ÷ 1024 = 46.875 フレーム/秒）。
    private const val AAC_SAMPLES_PER_FRAME = 1024
    // 下限/上限のクランプ。上限はライブラリ既定＝これ以上は広げない（広げても意味がない）。
    private const val SEND_CACHE_MIN_ITEMS = 60
    private const val SEND_CACHE_MAX_ITEMS = 400
    // キュー統計ログの間引き間隔（配信中に処理を増やさない）。
    private const val STATS_LOG_INTERVAL_MS = 1000L
  }
}
