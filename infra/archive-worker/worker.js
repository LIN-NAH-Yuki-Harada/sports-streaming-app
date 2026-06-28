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
    "-crf", "23",
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
    await spawnP("ffmpeg", args);
    return { path: outPath, scored: true };
  } catch (e) {
    // 焼き込み失敗（短い断片のPNG生成失敗等）でも、生のまま返さず必ず canonical に正規化する。
    // 生(元params)のまま連結に渡すと、焼き込み済(libx264)セグメントとparam不一致で連結が
    // 境界で打ち切られる（seg1を落として2秒になる事象）。オーバーレイ無しで同一paramsに揃える。
    log(`seg${idx}: burn failed -> normalize without overlay: ${String(e).slice(0, 120)}`);
    await spawnP("ffmpeg", [
      "-y", "-i", recPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
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
  const inputs = [];
  paths.forEach((p) => inputs.push("-i", p));
  let fc = "";
  paths.forEach((_, i) => {
    fc += `[${i}:v:0]scale=1280:720,fps=30,format=yuv420p,setsar=1[v${i}];`;
    fc += `[${i}:a:0]aresample=48000:async=1:first_pts=0[a${i}];`;
  });
  const cat = paths.map((_, i) => `[v${i}][a${i}]`).join("");
  fc += `${cat}concat=n=${paths.length}:v=1:a=1[v][a]`;
  await spawnP("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", fc,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outPath,
  ]);
  return outPath;
}

async function setStatus(id, fields) {
  await admin.from("broadcasts").update(fields).eq("id", id);
}

async function main() {
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

  // 3-2. 極小セグメント(数秒)を除外。4G再接続でできる断片はキーフレーム前から始まり壊れている
  //      ことがあり、連結を破壊する（filter_complexで stream 不在 / demuxerで尺打ち切り）。
  //      5秒未満は捨てる。全部短い極端ケースは最長1本だけ残す（空にしない）。
  {
    const MIN_SEG_SEC = 5;
    const withDur = [];
    for (const r of recs) {
      withDur.push({ r, d: await ffprobeDurationSec(r.p).catch(() => 0) });
    }
    let kept = withDur.filter((x) => x.d >= MIN_SEG_SEC).map((x) => x.r);
    if (kept.length === 0 && withDur.length > 0) {
      kept = [withDur.sort((a, b) => b.d - a.d)[0].r];
    }
    if (kept.length !== recs.length) {
      log(`dropped ${recs.length - kept.length} tiny segment(s) (<${MIN_SEG_SEC}s)`);
    }
    recs = kept;
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
  // 中間生成物（PNG/焼き込みセグメント/concat結果）は os.tmpdir 配下に作って確実に消す。
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `spotch_${b.id}_`));
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

    const videoId = await uploadToYouTube(finalPath, b, oauth);
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
