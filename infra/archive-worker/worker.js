// LIVE SPOtCH アーカイブワーカー（VPS常駐・systemd timer から数分ごとに起動）
// 終了した「自前配信(MediaMTX録画)」を、配信者のYouTubeへ限定公開でアップロードする。
//   1起動 = 最大1配信。録画にスコアボード(③)を ffmpeg で焼き込んでからアップ。
//   既存 web/src/lib/youtube-upload.ts のロジックを移植（OAuth/分類/リトライ/完了処理）。
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const { buildScoreboardSvg } = require("./scoreboard-svg");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
} = process.env;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/var/recordings";
const MAX_RETRY = 5;
// 終了からこの時間を過ぎても録画が無ければ録画OFF時代/取りこぼしと判断して即 failed。
const RECORDING_WAIT_MS = 30 * 60 * 1000;

// ===== 画質/運用チューニング（2026-07-12 v2・env で上書き可）=====
// 中間エンコード（焼き込み/連結）の CRF。17 は視覚的にほぼ無劣化域＝
// 「本気の圧縮は最終 canonicalize の1回だけ」にして世代劣化を解消する。
const CRF_INTERMEDIATE = process.env.CRF_INTERMEDIATE || "17";
// 最終 canonicalize の CRF（旧23→20。YouTubeに渡す原盤の質を引き上げ）。
const CRF_FINAL = process.env.CRF_FINAL || "20";
// この秒数未満の配信はアーカイブしない（誤スタートのゴミ動画がYouTubeに残る対策）。
// env 誤設定（例 "300"）で実試合を捨てないよう上限60にクランプする。
const MIN_ARCHIVE_SEC = Math.min(
  Number(process.env.MIN_ARCHIVE_SEC || 30) || 30,
  60,
);
// "1" で最終出力を 1920x1080 にアップスケール（YouTube の割当ビットレートが上がる）。
// 処理時間 +10〜15分/試合のため既定 OFF。数試合検証後に .env で点灯する。
const UPSCALE_1080 = process.env.UPSCALE_1080 === "1";
// ffmpeg の -threads（libx264 のエンコードスレッドのみ制限・filter系は対象外＝効果は
// 部分的）。CPU 保護の主防御は systemd の CPUSchedulingPolicy=idle 側。既定は未指定。
const FFMPEG_THREADS = process.env.FFMPEG_THREADS || "";
// stale uploading のリクレーム閾値。**必ず service の TimeoutStartSec(10800s=3h) より
// 長くする**（Timeout kill 前の正常走行中ジョブをリクレームしないため。4h=余裕込み）。
const STALE_UPLOADING_MS = 4 * 60 * 60 * 1000;
// SIGKILL 時は finally が走らず中間ファイルが残るため、古い作業dirを起動時に掃除する。
const ORPHAN_WORKDIR_MS = 24 * 60 * 60 * 1000;

// ===== ライブ並走バックオフ（live-aware backoff・2026-07-22 / レビュー反映版）=====
// 進行中ライブがある tick は、重い ffprobe/ffmpeg/YouTubeアップロードを次tick(5分後)へ
// 見送り、MediaMTX の HLS 分割・視聴 egress・上り帯域・ディスクIO をライブに明け渡す。
// 【rollout】未実測事項(ライブ中に stream_playback_url が set 済みか)が残るため既定 OFF。
// VPS の .env で明示 "1" にして数日観測してから本採用する（＝opt-in / 攻めすぎ回避）。
const LIVE_BACKOFF_ENABLED = process.env.LIVE_BACKOFF_ENABLED === "1";
// starvation 回避の猶予。ended_at からこの時間以上待たされたら、ライブ並走でも強制処理する
// (遅延の絶対上限を保証する安全弁)。既定 45分。
const LIVE_BACKOFF_MAX_DEFER_MS =
  Number(process.env.LIVE_BACKOFF_MAX_DEFER_MS) || 45 * 60 * 1000;
// 「生きているライブ」と数える started_at の新しさ上限。心拍(last_seen)列が無いための近似。
// web cron cleanup の 2h とは密結合させず独立に既定 3h（2h超の実試合でも保護を切らさない）。
const LIVE_ACTIVE_MAX_AGE_MS =
  Number(process.env.LIVE_ACTIVE_MAX_AGE_MS) || 3 * 60 * 60 * 1000;

// ===== ゴースト掃除（MediaMTX 実体照合・ghost sweep・2026-07-25）=====
// DB が status='live' なのに MediaMTX に映像が来ていない配信（アプリ異常終了・電池切れ・
// 発熱シャットダウン等のゴースト）を検知して ended にする。判定は「サーバーに実際に
// publish が居るか」（localhost の MediaMTX API・外部通信なし）なので実配信を誤爆しない。
// 誤爆防止の三重保険:
//   (1) 開始 GHOST_MIN_AGE_MS(既定10分) 未満は対象外（provision〜publish 開始の猶予）
//   (2) 掃除は GHOST_SWEEP_INTERVAL_MS(既定20分) 毎にしか走らない（tick は5分毎でも間引く）
//   (3) 「2回連続で不在」のときだけ ended（一瞬の切断→再接続を救う）＝確定まで実効40〜50分
// MediaMTX API 到達不能・DB エラー時は何もしない（フェイルオープン＝終了させない側へ倒す）。
const GHOST_SWEEP_ENABLED = process.env.GHOST_SWEEP_ENABLED === "1";
const GHOST_SWEEP_INTERVAL_MS =
  Number(process.env.GHOST_SWEEP_INTERVAL_MS) || 20 * 60 * 1000;
const GHOST_MIN_AGE_MS = Number(process.env.GHOST_MIN_AGE_MS) || 10 * 60 * 1000;
const MEDIAMTX_API_BASE = process.env.MEDIAMTX_API_BASE || "http://127.0.0.1:9997";
const GHOST_SWEEP_STATE_PATH = "/var/tmp/archive-worker-ghost-sweep.json";

// ===== サーバー稼働メトリクス（admin「サーバー」タブ用・2026-07-26）=====
// tick(5分)毎に自分の健康状態を計測し Supabase の server_metrics へ push する
// 「押し込み方式」。外部からの問い合わせ口を一切開けない（攻撃面ゼロ）。
// ディスクI/O・NW帯域は /proc の累積カウンタを状態ファイルに保存し、前tickとの
// 差分から平均レートを算出（単位は全て kbps=キロビット/秒。表示側で換算）。
const METRICS_ENABLED = process.env.METRICS_ENABLED === "1";
const METRICS_STATE_PATH = "/var/tmp/archive-worker-metrics.json";
const METRICS_RETENTION_DAYS = 30;

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !YOUTUBE_CLIENT_ID ||
  !YOUTUBE_CLIENT_SECRET
) {
  console.error(
    "[archive] missing env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function log(...a) {
  console.log("[archive]", ...a);
}

// /var/recordings/live/<code>/*.mp4 を全て、開始時刻順(=ファイル名順)で返す。
// 4G再接続で複数セグメントに分割されることがあるため、全編を連結対象にする。
// 0バイト(録画失敗/書き込み中)は除外。録画なしは [] を返す。
function findRecordings(shareCode) {
  const dir = path.join(RECORDINGS_DIR, "live", shareCode);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.toLowerCase().endsWith(".mp4"))
    .map((f) => {
      const p = path.join(dir, f);
      return { p, name: f, size: fs.statSync(p).size };
    })
    .filter((x) => x.size > 0)
    // MediaMTX の録画名 2026-06-26_14-51-55-830050.mp4 は辞書順=時系列順。
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getOAuthClient(refreshToken, accessToken, profileId) {
  const oauth = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
  );
  oauth.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth.getAccessToken();
  if (token && token !== accessToken) {
    await admin
      .from("profiles")
      .update({ youtube_access_token: token })
      .eq("id", profileId);
  }
  return oauth;
}

// ★ アップロード前ゲート（2026-08-05 追加）
//
// YouTube は「15分を超える動画」をチャンネル単位で制限している（電話番号の確認で解放）。
// ★最悪なのは、制限を超えた動画でも **insert 自体は成功する**こと。YouTube は一旦受け取り、
//   後から（数分〜数時間後に）削除する。つまり **insert の結果では検知できない**。
//   従来は videoId が返った時点で completed にし、その直後に元録画を削除していたため、
//   失敗が記録されないまま元データも消えていた。
//   実損5本: 2026-08/02 103.6分・08/01 99.3分・07/30 59.0分・07/22 46.6分・07/22 35.7分
//
// 事後に生存確認する案も検討したが、**それでは「消えたことを後から知る」だけで試合記録は救えない**
// （電話番号未確認のチャンネルでは何度リトライしても必ず消えるため）。事前に弾くのが唯一の解。
//
// コスト: channels.list は 1 ユニット。videos.insert の投稿枠とは別プールから引くので実質無料。
// 権限: youtube.readonly は最初から要求済み → **既存の refresh_token でそのまま動く**（再連携不要）。
//
// ★制限はチャンネル単位で、しかも**変化する**（実データで、あるチャンネルが1日で
//   allowed になった例を確認）。キャッシュせず毎回取る。
const LONG_UPLOAD_LIMIT_SEC = 15 * 60; // これを超えると longUploadsStatus の確認が要る
const YOUTUBE_MAX_UPLOAD_SEC = 12 * 60 * 60; // YouTube の絶対上限

async function checkLongUploadGate(oauth, durationSec) {
  if (durationSec > YOUTUBE_MAX_UPLOAD_SEC) {
    return {
      ok: false,
      message:
        `この録画は約${Math.round(durationSec / 3600)}時間で、YouTubeの上限（12時間）を超えています。\n` +
        `アップロードしても削除されるため、中止しました。元の録画はサーバーに48時間だけ残ります。`,
    };
  }
  if (durationSec <= LONG_UPLOAD_LIMIT_SEC) return { ok: true };

  let longStatus = null;
  try {
    const youtube = google.youtube({ version: "v3", auth: oauth });
    const res = await youtube.channels.list({ part: ["status"], mine: true });
    const item = res.data && res.data.items && res.data.items[0];
    longStatus = item && item.status && item.status.longUploadsStatus;
  } catch (e) {
    // ★フェイルオープン。判定できないことを理由にアーカイブを止めない。
    //   ここで閉じると「APIが一時的に不調 → 全部のアーカイブが失敗」になる。
    log("longUploadsStatus check failed (fail-open):", String(e).slice(0, 200));
    return { ok: true };
  }
  // 値は allowed / eligible / disallowed / longUploadsUnspecified。allowed 以外は上げない。
  // 取得できなかった場合（null）もフェイルオープン。
  if (!longStatus || longStatus === "allowed") return { ok: true };

  return {
    ok: false,
    message:
      `この録画は約${Math.round(durationSec / 60)}分ですが、YouTubeチャンネルが「15分を超える動画」を\n` +
      `アップロードできる状態になっていません（longUploadsStatus=${longStatus}）。\n` +
      `このままアップロードすると、YouTubeが一旦受け取ったあとで削除してしまうため中止しました。\n` +
      `\n` +
      `【対処】配信者ご本人が https://www.youtube.com/verify で電話番号の確認を行ってください\n` +
      `（数分で完了・身分証は不要です）。反映まで最大24時間かかることがあります。\n` +
      `確認後、この配信の youtube_upload_status を 'pending'、youtube_retry_count を 0 に\n` +
      `戻せば自動で再実行されます。\n` +
      `\n` +
      `※ 元の録画はサーバーに48時間だけ残ります。それを過ぎると復旧できません。`,
  };
}

async function uploadToYouTube(filePath, b, oauth) {
  const youtube = google.youtube({ version: "v3", auth: oauth });
  const dateLabel = b.started_at
    ? new Date(b.started_at).toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
      })
    : "";
  const title = [`${b.home_team} vs ${b.away_team}`, dateLabel, b.tournament || ""]
    .filter((s) => s && s.length > 0)
    .join(" - ")
    .slice(0, 100);
  const description = [
    b.sport,
    b.tournament ? `大会: ${b.tournament}` : "",
    b.venue ? `会場: ${b.venue}` : "",
    "",
    "LIVE SPOtCH (https://live-spotch.com) で配信された試合のアーカイブです。",
  ]
    .filter((s) => s && s.length > 0)
    .join("\n")
    .slice(0, 5000);
  const tags = ["LIVE SPOtCH", b.sport, "スポーツ", "アーカイブ"].filter(
    (s) => s && s.length > 0,
  );
  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description, categoryId: "17", tags },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    },
    media: { mimeType: "video/mp4", body: fs.createReadStream(filePath) },
  });
  const id = res.data.id;
  if (!id) throw new Error("YouTube upload returned no video id");
  return id;
}

function classify(err) {
  const e = err || {};
  const msg = e.message || String(err);
  const codeNum = typeof e.code === "number" ? e.code : Number(e.code);
  const status = !Number.isNaN(codeNum) ? codeNum : e.response && e.response.status;
  if (
    msg.includes("invalid_grant") ||
    msg.includes("Token has been expired or revoked") ||
    msg.includes("re-link")
  ) {
    return { type: "token-revoked", msg };
  }
  // YouTube API 日次クォータ超過。
  // ★2026-08-05 訂正: videos.insert は「1600ユニット」ではなく**投稿本数の専用枠（1日100本）**で、
  //   標準の10,000ユニットプールとは別勘定（旧コメントの「≒6本/日」は誤り）。
  //   ユニットを消費するのは channels.list(1) や videos.list(1) などの読み取り側。
  // 403 で届くため auth-refresh より先に判定する。クォータは翌日16時JSTに復活する
  // ので retry を消費せず pending 維持で翌日自動再開させる（従来は25分で永久failed化）。
  const reason =
    (e.errors && e.errors[0] && e.errors[0].reason) ||
    (e.response &&
      e.response.data &&
      e.response.data.error &&
      e.response.data.error.errors &&
      e.response.data.error.errors[0] &&
      e.response.data.error.errors[0].reason) ||
    "";
  if (
    reason === "quotaExceeded" ||
    reason === "uploadLimitExceeded" ||
    msg.includes("quotaExceeded") ||
    msg.includes("uploadLimitExceeded")
  ) {
    return { type: "quota", msg };
  }
  if (status === 401 || status === 403) return { type: "auth-refresh", msg };
  if (status === 429 || (status >= 500 && status < 600))
    return { type: "retry", msg };
  if (status >= 400 && status < 500) return { type: "fatal", msg };
  return { type: "retry", msg };
}

// ===== ③ サーバー側スコア焼き込み（SVGスコアボード → PNG → ffmpeg overlay）=====

// 録画ファイル名 2026-06-26_14-51-55-830050.mp4 → 開始時刻(epoch ms・VPSローカル=JST)
function recordingStartMs(recPath, fallbackIso) {
  const m = path
    .basename(recPath)
    .match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d+)/);
  if (m) {
    const ms = Math.floor(Number(`0.${m[7]}`) * 1000);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms).getTime();
  }
  return fallbackIso ? Date.parse(fallbackIso) : Date.now();
}

function spawnP(cmd, args) {
  return new Promise((resolve, reject) => {
    const pr = spawn(cmd, args);
    let out = "";
    let err = "";
    if (pr.stdout) pr.stdout.on("data", (d) => (out += d.toString()));
    if (pr.stderr)
      pr.stderr.on("data", (d) => {
        err += d.toString();
        if (err.length > 6000) err = err.slice(-3000);
      });
    pr.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${cmd} exit ${code}: ${err.slice(-500)}`)),
    );
    pr.on("error", reject);
  });
}

// ffmpeg 実行ヘルパー。FFMPEG_THREADS 設定時のみ、出力パス（最終引数）の直前に
// -threads を挿入する（全呼び出しで出力パスが末尾に来る前提＝本ファイル内の4箇所で確認済）。
function ffmpegP(args) {
  if (FFMPEG_THREADS) {
    args = [...args.slice(0, -1), "-threads", FFMPEG_THREADS, args[args.length - 1]];
  }
  return spawnP("ffmpeg", args);
}

async function ffprobeDurationSec(p) {
  try {
    const out = await spawnP("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      p,
    ]);
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

async function ffprobeWH(p) {
  try {
    const out = await spawnP("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
      p,
    ]);
    const [w, h] = out.trim().split("x").map(Number);
    return { w: w || 1280, h: h || 720 };
  } catch {
    return { w: 1280, h: 720 };
  }
}

// 音声トラックの有無を返す（正規化時に -af aresample を付けるか判定する）。
async function ffprobeHasAudio(p) {
  try {
    const out = await spawnP("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      p,
    ]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// 映像トラックの有無を返す。4G再接続では「音声だけで映像が無い」断片ができることが
// あり（2026-07-12 実発生・16秒audio-only断片）、これが混ざると連結の [i:v:0] が
// "matches no streams" で全失敗＝アーカイブ0本になる。断片選別で除外するための判定。
async function ffprobeHasVideo(p) {
  try {
    const out = await spawnP("ffprobe", [
      "-v", "error",
      "-select_streams", "v",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      p,
    ]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// 1セグメントにスコアボードを焼き込んだファイルパスを返す。イベント無し/失敗時は元(raw)。
// workDir = このセグメント専用の一時ディレクトリ（中間生成物の置き場・呼び出し側で削除）。
// idx = 同一配信内のセグメント番号（一時ファイル名の衝突回避用）。
// events = 配信全体のスコアイベント（全セグメントで共有。区間は各ファイルの開始時刻で切る）。
// 返り値 { path, scored } scored=true のとき path は焼き込み済みの中間ファイル。
async function burnScoreboard(recPath, b, events, workDir, idx) {
  if (!events || events.length === 0) {
    log(`seg${idx}: no score events -> raw`);
    return { path: recPath, scored: false };
  }
  const durationMs = (await ffprobeDurationSec(recPath)) * 1000;
  if (!durationMs) {
    log(`seg${idx}: ffprobe duration 0 -> raw`);
    return { path: recPath, scored: false };
  }
  const { w, h } = await ffprobeWH(recPath);
  // 各セグメントは自身のファイル名から開始時刻を算出 → 再接続ギャップがあっても
  // 区間がそのセグメント内で正しく揃う（連結後に1回焼くとギャップ分ズレる）。
  const fileStartMs = recordingStartMs(recPath, b.started_at);

  // 各イベントの表示区間（録画ファイル開始基準・秒・クランプ）
  const segs = [];
  for (let i = 0; i < events.length; i++) {
    const s = Math.max(0, Date.parse(events[i].at) - fileStartMs);
    const eRaw =
      i + 1 < events.length
        ? Date.parse(events[i + 1].at) - fileStartMs
        : durationMs;
    const e = Math.min(durationMs, eRaw);
    if (e <= 0 || s >= durationMs || e <= s) continue;
    segs.push({ ev: events[i], s: s / 1000, e: e / 1000 });
  }
  if (segs.length === 0) {
    log(`seg${idx}: no score segments in range -> raw`);
    return { path: recPath, scored: false };
  }

  // PNG/中間生成物はこのセグメント専用 workDir に置く（呼び出し側で一括削除）。
  const tmpdir = path.join(workDir, `seg${idx}`);
  fs.mkdirSync(tmpdir, { recursive: true });

  // 各区間の SVG → PNG（全画面・透明＋左上スコアボード）
  const pngs = [];
  for (let i = 0; i < segs.length; i++) {
    const ev = segs[i].ev;
    // 競技別の追加情報（野球=B/S/O、バレー=セットポイント等）= scoreboard_text の period より後ろ
    const periodStr = ev.period || "";
    const txt = ev.scoreboard_text || "";
    let extra = "";
    if (periodStr && txt.includes(periodStr)) {
      extra = txt.slice(txt.lastIndexOf(periodStr) + periodStr.length).trim();
    }
    const svg = buildScoreboardSvg(
      {
        homeTeam: b.home_team,
        awayTeam: b.away_team,
        homeScore: ev.home_score,
        awayScore: ev.away_score,
        homeSets: ev.home_sets,
        awaySets: ev.away_sets,
        period: ev.period,
        extra,
      },
      { width: w, height: h },
    );
    const svgPath = `${tmpdir}/s${i}.svg`;
    const pngPath = `${tmpdir}/s${i}.png`;
    fs.writeFileSync(svgPath, svg);
    await spawnP("rsvg-convert", [
      "-w", String(w),
      "-h", String(h),
      "-o", pngPath,
      svgPath,
    ]);
    pngs.push(pngPath);
  }

  // ffmpeg: 各PNGを区間 enable で重ねる
  const outPath = path.join(tmpdir, "scored.mp4");
  const args = ["-y", "-i", recPath];
  pngs.forEach((p) => args.push("-i", p));
  let fc = "";
  let cur = "0:v";
  segs.forEach((seg, i) => {
    const inp = `${i + 1}:v`;
    const outLabel = i === segs.length - 1 ? "vout" : `v${i}`;
    fc += `[${cur}][${inp}]overlay=0:0:enable='between(t,${seg.s.toFixed(2)},${seg.e.toFixed(2)})'[${outLabel}];`;
    cur = outLabel;
  });
  fc = fc.replace(/;$/, "");
  args.push(
    "-filter_complex", fc,
    "-map", "[vout]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", CRF_INTERMEDIATE,
    "-pix_fmt", "yuv420p",
    // 固定フレームレート(CFR 30)に正規化。配信側アダプティブが可変fpsにすると
    // 再生不可/尺崩れになるため、ここで30fps一定に焼き直す。音声も再エンコード＋
    // aresample で映像タイムラインに同期（着信中の無音区間のズレも吸収）。
    "-r", "30",
    "-af", "aresample=async=1:first_pts=0",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    outPath,
  );
  log(
    `seg${idx}: burning scoreboard SVG (${segs.length} score segments, ${w}x${h}, dur ${Math.round(durationMs / 1000)}s)`,
  );
  try {
    await ffmpegP(args);
    return { path: outPath, scored: true };
  } catch (e) {
    // 焼き込み失敗（短い断片のPNG生成失敗等）でも、生のまま返さず必ず canonical に正規化する。
    // 生(元params)のまま連結に渡すと、焼き込み済(libx264)セグメントとparam不一致で連結が
    // 境界で打ち切られる（seg1を落として2秒になる事象）。オーバーレイ無しで同一paramsに揃える。
    log(`seg${idx}: burn failed -> normalize without overlay: ${String(e).slice(0, 120)}`);
    await ffmpegP([
      "-y", "-i", recPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", CRF_INTERMEDIATE,
      "-pix_fmt", "yuv420p", "-r", "30",
      "-af", "aresample=async=1:first_pts=0",
      "-c:a", "aac", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      outPath,
    ]);
    return { path: outPath, scored: false };
  }
}

// 複数の mp4 を1本に連結する。各入力を独立にデコード→正規化(1280x720/30fps/yuv420p/SAR1/
// 48kHz)→concatフィルタで再タイムして再エンコードする。
// ★ -c copy も concat demuxer も使わない：パラメータ/タイムスタンプ不一致で尺が打ち切られる
//   （25分が4秒に切れる事象）。filter_complex は各入力を独立にデコードして連結するので、
//   別々にエンコードされたセグメントでも崩れない。極小/壊れた断片は呼び出し側(3-2)で除外済み。
async function concatSegments(paths, workDir) {
  const outPath = path.join(workDir, "concat.mp4");

  // ★ 各セグメントの音声有無を事前に調べる。4G再接続や着信で「音声トラックが無い
  //   セグメント」が混ざると、全入力に [i:a:0] を要求する連結は ffmpeg が
  //   「Stream specifier :a:0 matches no streams」で全失敗→アーカイブ0本になる。
  //   音声が有るセグメントの音声は保持しつつ、欠落セグメントだけ無音(anullsrc)で
  //   補って連結を必ず成立させる（全セグメント音声有りなら従来と同一グラフ）。
  const meta = [];
  for (const p of paths) {
    meta.push({
      p,
      hasAudio: await ffprobeHasAudio(p),
      hasVideo: await ffprobeHasVideo(p),
      dur: await ffprobeDurationSec(p),
    });
  }
  // ★ 二重防御: 映像の無い入力は連結から除外する（[i:v:0] が "matches no streams"
  //   で全失敗するため）。呼び出し側(3-2)で除外済みのはずだが、焼き込みのフォール
  //   バック等で audio-only の中間ファイルが紛れる経路に備える。
  const noVideo = meta.filter((m) => !m.hasVideo);
  if (noVideo.length > 0) {
    log(`concat: dropping ${noVideo.length} input(s) without video stream`);
  }
  const usable = meta.filter((m) => m.hasVideo);
  if (usable.length === 0) {
    throw new Error("concat: no input has a video stream");
  }
  if (usable.length === 1) {
    return usable[0].p; // 1本だけ残ったら連結不要
  }
  meta.length = 0;
  meta.push(...usable);
  paths = usable.map((m) => m.p);

  const inputs = [];
  meta.forEach((m) => inputs.push("-i", m.p)); // 入力 0..N-1 = 実セグメント
  // 音声欠落セグメント用の無音入力を後ろに足す（各セグメント尺に合わせる）。
  const silenceIdx = {};
  let nextIdx = paths.length;
  meta.forEach((m, i) => {
    if (!m.hasAudio) {
      const d = m.dur > 0 ? m.dur : 1;
      inputs.push(
        "-f", "lavfi",
        "-t", d.toFixed(3),
        "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
      silenceIdx[i] = nextIdx;
      nextIdx += 1;
    }
  });

  let fc = "";
  meta.forEach((m, i) => {
    fc += `[${i}:v:0]scale=1280:720,fps=30,format=yuv420p,setsar=1[v${i}];`;
    const aSrc = m.hasAudio ? `${i}:a:0` : `${silenceIdx[i]}:a:0`;
    fc += `[${aSrc}]aresample=48000:async=1:first_pts=0[a${i}];`;
  });
  const cat = paths.map((_, i) => `[v${i}][a${i}]`).join("");
  fc += `${cat}concat=n=${paths.length}:v=1:a=1[v][a]`;
  await ffmpegP([
    "-y",
    ...inputs,
    "-filter_complex", fc,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    // 連結は中間工程＝ほぼ無劣化で通し、圧縮は最終 canonicalize に一任する。
    "-crf", CRF_INTERMEDIATE,
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outPath,
  ]);
  return outPath;
}

// ★ アップロード直前に必ず通す「YouTube安全化」正規化。
// 配信側アダプティブビットレートで録画が可変fps/壊れたPTSになり得る。raw無加工や
// 不十分な正規化のままアップすると YouTube が「処理を中止しました（この動画は処理されません
// でした）」で再生不可になる。raw/焼き込み/連結いずれの結果でも最終的に
// CFR30・H.264 High・yuv420p・AAC48k/2ch・faststart・PTS再生成 に揃える。
// 音声が無い録画でも落ちないよう、音声トラックがある時だけ音声処理を付ける。
async function canonicalize(inputPath, outPath) {
  const hasAudio = await ffprobeHasAudio(inputPath);
  // UPSCALE_1080: 入力（burn/concat 出力または raw）が正確に 1280x720 と実測できた
  // ときだけ 1920x1080 へアップスケール（YouTube の 1080p ティアは 720p より割当
  // ビットレートが高く、再圧縮後の見た目が改善する既知のテクニック）。固定寸法＋
  // setsar=1 なので level 4.1 の幅制限・SAR・偶数化の辺縁ケースは発生しない。
  // probe 失敗（フォールバック値でも w/h は 1280x720 になるが、その場合は実測
  // 720p と区別できないだけで拡大しても無害）や 720p 以外は既存の偶数化 vf を維持。
  let vf = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  if (UPSCALE_1080) {
    const { w, h } = await ffprobeWH(inputPath);
    if (w === 1280 && h === 720) {
      vf = "scale=1920:1080:flags=lanczos,setsar=1";
    }
  }
  const args = [
    "-y",
    "-fflags", "+genpts", // 非単調/欠落PTSを再生成（RTMP再接続録画対策）
    "-i", inputPath,
    "-map", "0:v:0",
    // 既定 vf: 奇数寸法を偶数化（yuv420p要件・"width not divisible by 2"失敗防止）。
    "-vf", vf,
    "-vsync", "cfr", // 出力を固定フレームレート化（可変fpsをYouTube処理可能に）
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", CRF_FINAL,
    "-profile:v", "high",
    "-level", "4.1",
    "-pix_fmt", "yuv420p",
  ];
  if (hasAudio) {
    args.push(
      "-map", "0:a:0",
      "-af", "aresample=async=1:first_pts=0",
      "-c:a", "aac",
      "-ar", "48000",
      "-ac", "2",
    );
  }
  args.push("-max_muxing_queue_size", "1024", "-movflags", "+faststart", outPath);
  await ffmpegP(args);
  return outPath;
}

async function setStatus(id, fields) {
  await admin.from("broadcasts").update(fields).eq("id", id);
}

// SIGKILL（Timeout等）で finally が走らなかった過去実行の残骸を掃除する。
// 中間ファイルは1件5〜10GBになり得るため、放置すると /var/tmp を食い潰して
// MediaMTX の録画書き込み（同一FS）まで巻き込む。更新が古い spotch_* のみ削除。
function sweepOrphanWorkDirs() {
  const base = process.env.WORK_DIR || "/var/tmp";
  let names;
  try {
    names = fs.readdirSync(base).filter((n) => n.startsWith("spotch_"));
  } catch {
    return;
  }
  const cutoff = Date.now() - ORPHAN_WORKDIR_MS;
  for (const n of names) {
    const p = path.join(base, n);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.rmSync(p, { recursive: true, force: true });
        log("swept orphan workdir:", n);
      }
    } catch {
      /* 消せない残骸は次回に回す */
    }
  }
}

// SIGKILL で catch が走らず "uploading" のまま残った行を復旧する。
// 閾値 STALE_UPLOADING_MS(4h) は service の TimeoutStartSec(3h) より必ず長いこと
// （oneshot は単一インスタンスなので、4h 前に claim した実行は既に kill 済みと保証できる）。
// retry を必ず消費させる：増分なしだと「3hかけて kill → リクレーム → また3h」の
// 永久ループでライブ配信の CPU を恒常的に奪い続ける。
async function reclaimStaleUploading() {
  const cutoffIso = new Date(Date.now() - STALE_UPLOADING_MS).toISOString();
  const { data: stale } = await admin
    .from("broadcasts")
    .select("id, share_code, youtube_retry_count")
    .eq("youtube_upload_status", "uploading")
    .lt("youtube_upload_started_at", cutoffIso);
  for (const s of stale || []) {
    const retry = s.youtube_retry_count || 0;
    const exhausted = retry >= MAX_RETRY - 1;
    await admin
      .from("broadcasts")
      .update({
        youtube_upload_status: exhausted ? "failed" : "pending",
        youtube_retry_count: retry + 1,
        youtube_upload_error:
          "reclaimed after stale uploading（タイムアウト等で中断。重複動画の可能性があれば YouTube Studio を確認）",
      })
      .eq("id", s.id)
      .eq("youtube_upload_status", "uploading"); // CAS: 同時実行への保険
    log(
      `reclaimed stale uploading: ${s.share_code} -> ${exhausted ? "failed" : "pending"} (retry ${retry + 1})`,
    );
  }
}

// 進行中ライブのうち、この VPS(MediaMTX)に負荷をかけるものだけを数える。
// status='live' かつ stream_playback_url IS NOT NULL(=MediaMTX経由。LiveKit経路は除外)
// かつ started_at が LIVE_ACTIVE_MAX_AGE_MS 以内(ゴースト残骸を近似除外)。
// 判定不能(DBエラー)は「ライブ無し」にフェイルオープン＝アーカイブを止めない側へ倒す。
async function countActiveMediaMtxLive() {
  const freshIso = new Date(Date.now() - LIVE_ACTIVE_MAX_AGE_MS).toISOString();
  const { data, error } = await admin
    .from("broadcasts")
    .select("id")
    .eq("status", "live")
    .not("stream_playback_url", "is", null)
    .gte("started_at", freshIso)
    .limit(5);
  if (error) {
    log("active-live check failed (assuming none):", error.message.slice(0, 120));
    return 0;
  }
  return (data || []).length;
}

// DB=live なのに MediaMTX に publisher が居ない配信を ended にする（ゴースト掃除）。
// 実行間隔・猶予・2回連続確認はファイル冒頭の GHOST_* 設定を参照。
async function sweepGhostBroadcasts() {
  // 実行間隔ゲート（worker tick は5分毎だが、掃除自体は GHOST_SWEEP_INTERVAL_MS 毎）
  let state = { lastRunMs: 0, suspects: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(GHOST_SWEEP_STATE_PATH, "utf8"));
    if (raw && typeof raw === "object") state = raw;
  } catch {
    /* 初回・破損時は初期値のまま */
  }
  if (!state.suspects || typeof state.suspects !== "object") state.suspects = {};
  if (Date.now() - (Number(state.lastRunMs) || 0) < GHOST_SWEEP_INTERVAL_MS) return;

  // MediaMTX に現在 publish されている（ready な）パス名一覧。localhost のみ・外部通信なし。
  // ready は MediaMTX v1.17.0 で deprecated（後継 available/online）のため両方を見る。
  // 「HTTP 200 だがスキーマが変質」も skip 側へ倒す（将来の MediaMTX 更新で全ライブを
  // 一斉誤爆しないための構造ガード）。
  let activePaths;
  try {
    const res = await fetch(`${MEDIAMTX_API_BASE}/v3/paths/list?itemsPerPage=100`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const body = await res.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if ((Number(body.pageCount) || 1) > 1) {
      log("ghost sweep: paths > 1 page (unsupported, skip)");
      return;
    }
    const flagged = items.filter(
      (p) =>
        p &&
        (typeof p.ready === "boolean" ||
          typeof p.available === "boolean" ||
          typeof p.online === "boolean"),
    );
    if (items.length > 0 && flagged.length === 0) {
      log("ghost sweep: api schema changed? no ready/available/online flags (skip)");
      return; // スキーマ変質＝判定不能として何もしない
    }
    activePaths = new Set(
      items
        .filter((p) => p && (p.ready === true || p.available === true || p.online === true))
        .map((p) => String(p.name)),
    );
  } catch (e) {
    log("ghost sweep: mediamtx api unreachable (skip, no action):", String(e).slice(0, 100));
    return; // フェイルオープン: 実体を確認できないときは絶対に終了させない
  }

  const minAgeIso = new Date(Date.now() - GHOST_MIN_AGE_MS).toISOString();
  const { data, error } = await admin
    .from("broadcasts")
    .select("id, share_code, started_at")
    .eq("status", "live")
    .not("stream_playback_url", "is", null)
    .lt("started_at", minAgeIso)
    .limit(20);
  if (error) {
    log("ghost sweep: db read failed (skip):", error.message.slice(0, 100));
    return;
  }

  const candidates = data || [];
  const absent = candidates.filter((b) => !activePaths.has(`live/${b.share_code}`));
  // 回路遮断（精密版・7/25実測反映）: 候補複数が全滅＋activeパス0本は「APIの意味が壊れた」
  // 疑いがある。ただし発熱日は1セッションから複数ゴーストが同時発生するのが実態
  // （7/25実測: 3本同時）なので、無条件skipにせずディスクの録画 mtime を実体証拠に使う:
  //   いずれかの候補の最新録画が5分以内に更新中 → 実はpublish中(API不整合)とみなし skip
  //   全候補の録画が5分以上停止 → 本当に全滅している → 掃除を続行（連鎖ゴーストを掃除）
  if (candidates.length >= 2 && absent.length === candidates.length && activePaths.size === 0) {
    const freshMs = 5 * 60 * 1000;
    const anyFresh = candidates.some((b) => {
      const recs = findRecordings(b.share_code);
      if (recs.length === 0) return false;
      try {
        return Date.now() - fs.statSync(recs[recs.length - 1].p).mtimeMs < freshMs;
      } catch {
        return false;
      }
    });
    if (anyFresh) {
      log(`ghost sweep: all ${candidates.length} absent but fresh recording exists (api mismatch?, skip)`);
      return;
    }
    log(`ghost sweep: all ${candidates.length} absent & recordings stale -> proceed (correlated ghosts)`);
  }

  const nextSuspects = {};
  for (const b of candidates) {
    if (activePaths.has(`live/${b.share_code}`)) continue; // 実配信 → 容疑解除
    // 一度も MediaMTX に publish していない行（provision 後に LiveKit へフォールバック
    // した実ライブ等）は録画実体を持たない → 対象外（strike も付けない）。
    // 本物のゴースト＝一度は publish した配信は必ず録画ファイルを持つ。
    const recs = findRecordings(b.share_code);
    if (recs.length === 0) continue;
    const strikes = (Number(state.suspects[b.id]) || 0) + 1;
    if (strikes >= 2) {
      // 2回連続不在 → ゴースト確定。status='live' の CAS 条件で実終了処理と競合しない。
      // ended_at は掃除時刻でなく最終録画ファイルの mtime（≒実際の切断時刻）を使う。
      // （掃除時刻だと壁時計とみなされ、極短配信の cancel 判定が壊れるため）
      let endedAtIso = new Date().toISOString();
      try {
        const lastRec = recs[recs.length - 1];
        const mtimeMs = fs.statSync(lastRec.p).mtimeMs;
        if (Number.isFinite(mtimeMs) && mtimeMs > 0) {
          endedAtIso = new Date(mtimeMs).toISOString();
        }
      } catch {
        /* mtime 取得失敗時は現在時刻のまま */
      }
      const { error: upErr } = await admin
        .from("broadcasts")
        .update({ status: "ended", ended_at: endedAtIso })
        .eq("id", b.id)
        .eq("status", "live");
      if (upErr) {
        log(`ghost sweep: end failed ${b.share_code}:`, upErr.message.slice(0, 100));
        nextSuspects[b.id] = strikes; // 次回リトライ
      } else {
        log(
          `ghost sweep: ended ghost ${b.share_code} (no publisher x${strikes}, started ${b.started_at}, ended_at=${endedAtIso})`,
        );
      }
    } else {
      nextSuspects[b.id] = strikes;
      log(
        `ghost sweep: suspect ${b.share_code} (no publisher x${strikes}, recheck in ~${Math.round(GHOST_SWEEP_INTERVAL_MS / 60000)}min)`,
      );
    }
  }

  try {
    fs.writeFileSync(
      GHOST_SWEEP_STATE_PATH,
      JSON.stringify({ lastRunMs: Date.now(), suspects: nextSuspects }),
    );
  } catch (e) {
    log("ghost sweep: state save failed (ignored):", String(e).slice(0, 100));
  }
}

// サーバー稼働メトリクスを1行計測して server_metrics へ push（失敗は全て無視＝本処理へ影響ゼロ）
async function collectServerMetrics() {
  // CPU: 1分ロードアベレージ/コア数・メモリ: os情報から
  const cpuLoadPct =
    Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 1000) / 10;
  const memUsedPct =
    Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 1000) / 10;

  // ディスク使用率: df -B1 /
  let diskUsedPct = null;
  try {
    const out = await new Promise((resolve) => {
      const p = spawn("df", ["-B1", "/"]);
      let s = "";
      p.stdout.on("data", (d) => (s += d));
      p.on("close", () => resolve(s));
      p.on("error", () => resolve(""));
    });
    const cols = String(out).trim().split("\n").pop().split(/\s+/);
    const size = Number(cols[1]);
    const used = Number(cols[2]);
    if (size > 0) diskUsedPct = Math.round((used / size) * 1000) / 10;
  } catch {
    /* noop */
  }

  // ディスクI/O・NW帯域: /proc 累積カウンタの前tickとの差分（kbps）
  let diskReadKbps = null,
    diskWriteKbps = null,
    netRxKbps = null,
    netTxKbps = null;
  try {
    const cur = { t: Date.now(), dr: 0, dw: 0, rx: 0, tx: 0 };
    for (const l of fs.readFileSync("/proc/diskstats", "utf8").split("\n")) {
      const f = l.trim().split(/\s+/);
      if (f.length < 14) continue;
      // 物理デバイスのみ（パーティション・loopを除外）
      if (!/^(sd[a-z]|vd[a-z]|xvd[a-z]|nvme\d+n\d+)$/.test(f[2])) continue;
      cur.dr += Number(f[5]) * 512; // 読了セクタ(512B)
      cur.dw += Number(f[9]) * 512; // 書込セクタ(512B)
    }
    for (const l of fs.readFileSync("/proc/net/dev", "utf8").split("\n")) {
      const m = l.match(/^\s*([^:\s]+):\s*(.+)$/);
      if (!m || m[1] === "lo") continue;
      const f = m[2].trim().split(/\s+/);
      cur.rx += Number(f[0]);
      cur.tx += Number(f[8]);
    }
    let prev = null;
    try {
      prev = JSON.parse(fs.readFileSync(METRICS_STATE_PATH, "utf8"));
    } catch {
      /* 初回 */
    }
    if (prev && prev.t && cur.t > prev.t && cur.t - prev.t < 30 * 60 * 1000) {
      const dt = (cur.t - prev.t) / 1000;
      const kbps = (bytes) =>
        Math.max(0, Math.round(((bytes * 8) / 1000 / dt) * 10) / 10);
      diskReadKbps = kbps(cur.dr - prev.dr);
      diskWriteKbps = kbps(cur.dw - prev.dw);
      netRxKbps = kbps(cur.rx - prev.rx);
      netTxKbps = kbps(cur.tx - prev.tx);
    }
    fs.writeFileSync(METRICS_STATE_PATH, JSON.stringify(cur));
  } catch {
    /* noop */
  }

  // MediaMTX の配信中パス数（ghost sweep と同じ localhost API・不達は null）
  let livePaths = null;
  try {
    const res = await fetch(`${MEDIAMTX_API_BASE}/v3/paths/list?itemsPerPage=100`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = await res.json();
      livePaths = (Array.isArray(body.items) ? body.items : []).filter(
        (p) => p && (p.ready === true || p.available === true || p.online === true),
      ).length;
    }
  } catch {
    /* noop */
  }

  // アーカイブ待ち件数（ended かつ 未処理）
  let archiveQueue = null;
  try {
    const { count } = await admin
      .from("broadcasts")
      .select("id", { count: "exact", head: true })
      .eq("status", "ended")
      .not("stream_playback_url", "is", null)
      .or("youtube_upload_status.is.null,youtube_upload_status.eq.pending");
    archiveQueue = count ?? null;
  } catch {
    /* noop */
  }

  const { error } = await admin.from("server_metrics").insert({
    host: "vps-main",
    cpu_load_pct: cpuLoadPct,
    mem_used_pct: memUsedPct,
    disk_used_pct: diskUsedPct,
    disk_read_kbps: diskReadKbps,
    disk_write_kbps: diskWriteKbps,
    net_rx_kbps: netRxKbps,
    net_tx_kbps: netTxKbps,
    live_paths: livePaths,
    archive_queue: archiveQueue,
  });
  if (error) {
    log("metrics insert failed (ignored):", error.message.slice(0, 100));
    return;
  }
  // 保持期間より古い行の掃除（indexed delete・通常は数行）
  await admin
    .from("server_metrics")
    .delete()
    .lt(
      "created_at",
      new Date(Date.now() - METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    )
    .then(undefined, () => {});
}

async function main() {
  // 0. 保守: 残骸workDir掃除 + stale uploadingの復旧（どちらも失敗しても本処理は続行）
  try {
    sweepOrphanWorkDirs();
  } catch (e) {
    log("orphan sweep failed (ignored):", String(e).slice(0, 120));
  }
  try {
    await reclaimStaleUploading();
  } catch (e) {
    log("stale reclaim failed (ignored):", String(e).slice(0, 120));
  }
  if (GHOST_SWEEP_ENABLED) {
    try {
      await sweepGhostBroadcasts();
    } catch (e) {
      log("ghost sweep failed (ignored):", String(e).slice(0, 120));
    }
  }
  if (METRICS_ENABLED) {
    try {
      await collectServerMetrics();
    } catch (e) {
      log("metrics failed (ignored):", String(e).slice(0, 120));
    }
  }

  // 1. 対象 = 終了した自前配信(stream_playback_url 有)で未処理(null/pending)・retry 未超過
  const { data: rows, error } = await admin
    .from("broadcasts")
    .select(
      "id, share_code, broadcaster_id, home_team, away_team, sport, tournament, venue, started_at, ended_at, youtube_retry_count",
    )
    .eq("status", "ended")
    .not("stream_playback_url", "is", null)
    .or("youtube_upload_status.is.null,youtube_upload_status.eq.pending")
    .lt("youtube_retry_count", MAX_RETRY)
    .order("ended_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[archive] select failed:", error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    log("no pending");
    return;
  }
  const b = rows[0];
  const retry = b.youtube_retry_count || 0;

  // 2. 適格性（¥500チーム + 自動アーカイブON + YouTube連携済み）
  const { data: prof } = await admin
    .from("profiles")
    .select(
      "id, plan, youtube_auto_archive, youtube_access_token, youtube_refresh_token",
    )
    .eq("id", b.broadcaster_id)
    .single();
  const eligible =
    prof &&
    prof.plan === "team" &&
    prof.youtube_auto_archive !== false &&
    !!prof.youtube_refresh_token;
  if (!eligible) {
    await setStatus(b.id, {
      youtube_upload_status: "cancelled",
      youtube_upload_error: "not eligible (plan/auto_archive/youtube link)",
    });
    log("cancelled (not eligible):", b.share_code);
    return;
  }

  // 3. 録画ファイル（4G再接続で複数セグメントに分割されている場合がある → 全部取る）
  let recs = findRecordings(b.share_code);
  // completed 時の後始末は「この時点で列挙できたファイルだけ」を個別削除する
  // （ディレクトリ丸ごと削除だと、処理中に publisher が復帰して書き始めた
  //  進行中録画まで消してしまうため）。
  const enumeratedRecs = recs.slice();
  if (recs.length === 0) {
    const endedMs = b.ended_at ? Date.parse(b.ended_at) : 0;
    const ageMs = endedMs ? Date.now() - endedMs : Infinity;
    if (ageMs > RECORDING_WAIT_MS || retry >= MAX_RETRY - 1) {
      await setStatus(b.id, {
        youtube_upload_status: "failed",
        youtube_upload_error: "recording not found (predates recording or lost)",
        youtube_retry_count: retry,
      });
    } else {
      await setStatus(b.id, {
        youtube_upload_status: "pending",
        youtube_retry_count: retry + 1,
        youtube_upload_error: "recording not found yet (finalizing?)",
      });
    }
    log(
      "recording not found:",
      b.share_code,
      `age=${ageMs === Infinity ? "?" : Math.round(ageMs / 60000) + "min"}`,
    );
    return;
  }

  // 3-1b. ライブ並走バックオフ。非適格(step2 cancel)・録画なし(step3 fail)という
  //   「負荷ゼロで即キューから外れる」終端遷移はここより前で先に流す。守るのは直後(3-2)
  //   から始まる重い ffprobe/ffmpeg/アップロードだけ。見送り時は行を一切 UPDATE しない
  //   (pending/null のまま・retry 非消費)＝次tickへ持越し。
  if (LIVE_BACKOFF_ENABLED) {
    const endedMs = b.ended_at ? Date.parse(b.ended_at) : NaN;
    // ended_at 不明は待ち時間不明＝Infinity 扱いで「猶予超過(処理する側)」に倒す。
    const waitedMs = Number.isFinite(endedMs) ? Date.now() - endedMs : Infinity;
    if (waitedMs <= LIVE_BACKOFF_MAX_DEFER_MS) {
      const activeLive = await countActiveMediaMtxLive();
      if (activeLive > 0) {
        log(
          `deferring (live-aware backoff): ${b.share_code} activeLive=${activeLive} waited=${Math.round(waitedMs / 60000)}min < grace ${Math.round(LIVE_BACKOFF_MAX_DEFER_MS / 60000)}min`,
        );
        return; // 行は無変更のまま次tickへ
      }
    } else {
      log(
        `starvation override: ${b.share_code} waited=${Math.round(waitedMs / 60000)}min >= grace -> processing despite any live`,
      );
    }
  }

  // 3-2. 使えないセグメントを除外。4G再接続でできる断片は
  //      (a) 極小（キーフレーム前から始まり壊れている・5秒未満）
  //      (b) 映像トラックなし（音声だけ・2026-07-12に16秒audio-only断片が実発生）
  //      のことがあり、混ざると連結が「stream 不在 / 尺打ち切り」で全失敗する。
  //      全部除外される極端ケースは「映像がある最長の1本」だけ残す（空にしない）。
  //      映像のある断片がゼロなら、アーカイブ不能として明確に failed にする。
  // 「映像ありの全断片（除外分も含む）の合計尺」を極短判定(3-3)用に持ち出す。
  // kept だけの合計だと、細切れ断片（例 4秒×8本=実映像32秒）を誤って極短扱いしてしまう。
  let videoTotalSec = 0;
  {
    const MIN_SEG_SEC = 5;
    const withMeta = [];
    for (const r of recs) {
      withMeta.push({
        r,
        d: await ffprobeDurationSec(r.p).catch(() => 0),
        hasVideo: await ffprobeHasVideo(r.p),
      });
    }
    videoTotalSec = withMeta
      .filter((x) => x.hasVideo)
      .reduce((s, x) => s + (x.d > 0 ? x.d : 0), 0);
    let kept = withMeta
      .filter((x) => x.d >= MIN_SEG_SEC && x.hasVideo)
      .map((x) => x.r);
    if (kept.length === 0) {
      const longestWithVideo = withMeta
        .filter((x) => x.hasVideo)
        .sort((a, b) => b.d - a.d)[0];
      if (longestWithVideo) kept = [longestWithVideo.r];
    }
    if (kept.length === 0) {
      // 映像のある録画が1本も無い＝アーカイブしようがない。リトライループに
      // 落とさず明確に失敗させる（元録画ファイルは消さないので調査は可能）。
      await setStatus(b.id, {
        youtube_upload_status: "failed",
        youtube_upload_error: "no video stream in any recording segment",
        youtube_retry_count: retry,
      });
      log("failed (no video in recordings):", b.share_code);
      return;
    }
    if (kept.length !== recs.length) {
      const droppedMeta = withMeta.filter((x) => !kept.includes(x.r));
      const reasons = droppedMeta
        .map((x) => `${Math.round(x.d)}s${x.hasVideo ? "" : "/no-video"}`)
        .join(", ");
      log(`dropped ${recs.length - kept.length} unusable segment(s): ${reasons}`);
    }
    recs = kept;
  }

  // 3-3. 極短配信（誤スタート等）はアーカイブしない。ゴミ動画が配信者のYouTube
  //      チャンネルに積み上がる問題（2026-07-11 実発生・0〜1分動画が5本）への対策。
  //      誤cancel（＝実試合を取り逃す）が最悪なので、正方向の三重チェックが
  //      すべて真のときだけ cancel する（null/NaN はいずれも「cancelしない」に倒れる）:
  //        ①映像断片の合計尺が有限かつ MIN_ARCHIVE_SEC 未満
  //        ②配信の実時間(ended_at−started_at)も有限かつ MIN_ARCHIVE_SEC+15秒 未満
  //          （ffprobe が全滅して d=0 でも、実時間が長い配信は誤cancelしない保険）
  //        ③ended_at が10分以上前（MediaMTX のファイナライズ中＝moov未確定の録画を
  //          「短い」と誤measureする窓を排除。RECORDING_WAIT_MS と同思想）
  //      ※録画ファイルは削除しない（fail-closed 原則。ディスク上の数十MBは許容）。
  {
    const startedMs = b.started_at ? Date.parse(b.started_at) : NaN;
    const endedMs = b.ended_at ? Date.parse(b.ended_at) : NaN;
    const wallSec = (endedMs - startedMs) / 1000; // NaN なら以降の比較は必ず false
    const finalized =
      Number.isFinite(endedMs) && Date.now() - endedMs > 10 * 60 * 1000;
    const tooShort =
      Number.isFinite(videoTotalSec) &&
      videoTotalSec > 0 &&
      videoTotalSec < MIN_ARCHIVE_SEC &&
      Number.isFinite(wallSec) &&
      wallSec < MIN_ARCHIVE_SEC + 15 &&
      finalized;
    if (tooShort) {
      await admin
        .from("broadcasts")
        .update({
          youtube_upload_status: "cancelled",
          youtube_upload_error: `too short (<${MIN_ARCHIVE_SEC}s) — not archived`,
        })
        .eq("id", b.id)
        .or("youtube_upload_status.is.null,youtube_upload_status.eq.pending");
      log(
        `cancelled (too short): ${b.share_code} video=${Math.round(videoTotalSec)}s wall=${Math.round(wallSec)}s`,
      );
      return;
    }
  }

  // 3-4. ended なのに MediaMTX に publisher が復帰している（ゴースト誤終了→再接続、
  //      web cron が終了させたが実は配信継続中 等）なら、進行中の録画を変換しないよう
  //      行無変更で次tickへ見送る。API 不達はフェイルオープン＝従来どおり続行。
  if (GHOST_SWEEP_ENABLED) {
    try {
      const res = await fetch(`${MEDIAMTX_API_BASE}/v3/paths/list?itemsPerPage=100`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = await res.json();
        const stillPublishing = (Array.isArray(body.items) ? body.items : []).some(
          (p) =>
            p &&
            String(p.name) === `live/${b.share_code}` &&
            (p.ready === true || p.available === true || p.online === true),
        );
        if (stillPublishing) {
          log(`deferring (publisher active on mediamtx): ${b.share_code}`);
          return; // 行無変更＝retry 非消費で持ち越し
        }
      }
    } catch {
      /* API 不達は従来挙動のまま続行（フェイルオープン） */
    }
  }

  // 4. 楽観排他で uploading
  const { data: claimed } = await admin
    .from("broadcasts")
    .update({
      youtube_upload_status: "uploading",
      youtube_upload_started_at: new Date().toISOString(),
    })
    .eq("id", b.id)
    .or("youtube_upload_status.is.null,youtube_upload_status.eq.pending")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    log("claimed by another tick:", b.share_code);
    return;
  }

  const totalMB = recs.reduce((s, r) => s + r.size, 0) / 1e6;
  log(
    "processing",
    b.share_code,
    `${recs.length} segment(s)`,
    `${totalMB.toFixed(0)}MB`,
  );
  // 中間生成物（PNG/焼き込みセグメント/concat結果）の作業ディレクトリ。
  // ★ os.tmpdir()(=/tmp) は使わない：Ubuntu 24.04+ の /tmp は tmpfs(RAMディスク・
  //   容量=メモリの半分程度)で、45分級の連結/正規化出力(1.5GB超)が書き込み中に溢れて
  //   72〜85%地点で ffmpeg が死ぬ（2026-07-12 実発生・exit 228）。ディスク実体の
  //   /var/tmp を既定にする（WORK_DIR で上書き可）。処理後は finally で確実に消す。
  const workBase = process.env.WORK_DIR || "/var/tmp";
  const workDir = fs.mkdtempSync(path.join(workBase, `spotch_${b.id}_`));
  try {
    const oauth = await getOAuthClient(
      prof.youtube_refresh_token,
      prof.youtube_access_token,
      prof.id,
    );
    // 配信全体のスコアイベントを一度だけ取得（区間は各セグメントの開始時刻で切る）。
    const { data: events } = await admin
      .from("broadcast_score_events")
      .select(
        "at, scoreboard_text, home_score, away_score, home_sets, away_sets, period",
      )
      .eq("broadcast_id", b.id)
      .order("at", { ascending: true });

    // ③ 各セグメントに個別にスコアボードを焼く（再接続ギャップで時刻がズレないよう必須）。
    //    焼き込み失敗時はそのセグメントだけ生のまま使う（raw fallback）。
    const segPaths = [];
    for (let i = 0; i < recs.length; i++) {
      let segPath = recs[i].p;
      try {
        const burned = await burnScoreboard(recs[i].p, b, events, workDir, i);
        segPath = burned.path;
      } catch (e) {
        log(
          `seg${i}: scoreboard burn failed -> raw segment:`,
          String(e).slice(0, 200),
        );
        segPath = recs[i].p;
      }
      segPaths.push(segPath);
    }

    // 全セグメントを1本に連結（単一ファイルなら無駄なconcatを避けてそのまま）。
    let finalPath;
    if (segPaths.length === 1) {
      finalPath = segPaths[0];
      log("single segment -> no concat");
    } else {
      finalPath = await concatSegments(segPaths, workDir);
      const totalSec = Math.round(await ffprobeDurationSec(finalPath));
      log(
        `${segPaths.length} segments concatenated, total ${totalSec}s`,
      );
    }

    // ★ アップ直前に必ず YouTube 安全プロファイルへ正規化（可変fps録画の
    //   「処理を中止しました」根治）。正規化に失敗したら raw を上げず例外で retry に倒す
    //   （壊れた動画を作って元録画を消す事故を防ぐ）。
    let uploadPath;
    try {
      uploadPath = await canonicalize(finalPath, path.join(workDir, "final.mp4"));
    } catch (e) {
      throw new Error(`canonicalize failed: ${String(e).slice(0, 200)}`);
    }
    // アップ前の検証: 中身が壊れていないか（尺>0）。0なら上げずに例外（completed化＋元録画削除を防ぐ）。
    const finalDur = await ffprobeDurationSec(uploadPath);
    if (!finalDur || finalDur < 1) {
      throw new Error(`normalized output invalid (duration=${finalDur}s) — not uploading`);
    }
    log(`canonicalized & verified: ${Math.round(finalDur)}s -> uploading`);

    // ★ 15分ゲート: 上げても後から消される動画は、そもそも上げない（上の関数のコメント参照）。
    //   ここで止めれば元録画は残るので、配信者が電話番号確認を済ませてから再実行できる。
    const gate = await checkLongUploadGate(oauth, finalDur);
    if (!gate.ok) {
      log("long-upload gate blocked", b.share_code, `${Math.round(finalDur)}s`);
      await setStatus(b.id, {
        youtube_upload_status: "failed",
        youtube_upload_error: gate.message.slice(0, 500),
        youtube_retry_count: retry,
      });
      // 中間生成物だけ掃除。★元録画は残す（48時間以内なら再実行で救える）。
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
      return;
    }

    const videoId = await uploadToYouTube(uploadPath, b, oauth);
    await setStatus(b.id, {
      youtube_upload_status: "completed",
      youtube_video_id: videoId,
      youtube_upload_completed_at: new Date().toISOString(),
      youtube_upload_error: null,
    });
    // 後始末: 中間生成物 workDir 一式 + ローカル録画（全セグメント。YouTube unlisted が正本）
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    try {
      // 処理開始時に列挙したファイルのみ個別削除（進行中の新規録画は残す）。
      for (const r of enumeratedRecs) {
        try {
          fs.unlinkSync(r.p);
        } catch {
          /* 既に無い等は無視 */
        }
      }
      // 空になった場合だけディレクトリを畳む（中身が残っていれば失敗して残る＝意図どおり）
      try {
        fs.rmdirSync(path.join(RECORDINGS_DIR, "live", b.share_code));
      } catch {
        /* not empty → keep */
      }
    } catch (e) {
      log("local cleanup failed (ignored):", String(e));
    }
    log("completed", b.share_code, "->", videoId);
  } catch (err) {
    // 失敗時も中間生成物は消す（録画本体は次リトライのため残す）。
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    const c = classify(err);
    log("upload failed", b.share_code, c.type, c.msg);
    if (c.type === "quota") {
      // YouTube 日次クォータ超過は「明日になれば必ず直る」ので retry を消費せず
      // pending 維持（翌16時JSTのクォータ復活後に自動再開。永久failed化を防ぐ）。
      await setStatus(b.id, {
        youtube_upload_status: "pending",
        youtube_upload_error:
          "YouTube APIの1日のアップロード上限に達しました。翌日16時以降に自動で再開します。",
      });
      return;
    }
    const retryable = c.type === "retry" || c.type === "auth-refresh";
    if (retryable && retry < MAX_RETRY - 1) {
      await setStatus(b.id, {
        youtube_upload_status: "pending",
        youtube_retry_count: retry + 1,
        youtube_upload_error: c.msg.slice(0, 500),
      });
    } else {
      await setStatus(b.id, {
        youtube_upload_status: "failed",
        youtube_upload_error: (c.type === "token-revoked"
          ? c.msg + " (再連携が必要です)"
          : c.msg
        ).slice(0, 500),
        youtube_retry_count: retry,
      });
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[archive] fatal", e);
    process.exit(1);
  });
