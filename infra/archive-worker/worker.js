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
  // YouTube API 日次クォータ超過（videos.insert=1600unit・標準10,000unit/日≒6本/日）。
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
      fs.rmSync(path.join(RECORDINGS_DIR, "live", b.share_code), {
        recursive: true,
        force: true,
      });
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
