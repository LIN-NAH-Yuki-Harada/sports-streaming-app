// LIVE SPOtCH アーカイブワーカー（VPS常駐・systemd timer から数分ごとに起動）
// 役割: 終了した「自前配信(MediaMTX録画)」を、配信者のYouTubeへ限定公開でアップロードする。
//   1起動 = 最大1配信を処理（YouTube quota ~6本/日なので並列不要）。
//   既存 web/src/lib/youtube-upload.ts のロジックを移植（OAuth/分類/リトライ/完了処理）。
//   違い: 録画元 = Supabase Storage ではなく VPS ローカル /var/recordings、
//         アップロードは fs.createReadStream のストリーム（メモリ一定・大容量対応）。
// ※ Phase2(③)のスコア焼き込み(ffmpeg)は後で uploadToYouTube の前段に差し込む。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
} = process.env;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/var/recordings";
const MAX_RETRY = 5;
// 終了からこの時間を過ぎても録画が無ければ、録画OFF時代/取りこぼしと判断して即 failed
// （新しい配信は録画ファイナライズ待ちの可能性があるので、この時間内は retry）。
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

// 録画ファイルを探す。recordPath = /var/recordings/%path/... なので path="live/<code>" →
// /var/recordings/live/<code>/*.mp4。再接続で複数に割れた場合は最大サイズ(主セグメント)を採用。
// （複数セグメントの連結は将来対応。v1は最大ファイル）。
function findRecording(shareCode) {
  const dir = path.join(RECORDINGS_DIR, "live", shareCode);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const mp4s = files
    .filter((f) => f.toLowerCase().endsWith(".mp4"))
    .map((f) => {
      const p = path.join(dir, f);
      return { p, size: fs.statSync(p).size };
    })
    .filter((x) => x.size > 0)
    .sort((a, b) => b.size - a.size);
  return mp4s.length ? mp4s[0] : null;
}

// profiles の refresh_token から OAuth クライアントを準備（access_token は必ず再取得）。
async function getOAuthClient(refreshToken, accessToken, profileId) {
  const oauth = new google.auth.OAuth2(
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
  );
  // access_token をあえて渡さず、必ず refresh して新トークンを得る
  // （web 版で確立: expiry_date 未保存だと古い token が誤って使われる）。
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

// MP4 を配信者の YouTube に unlisted でストリーミングアップロード（メモリ一定）。
async function uploadToYouTube(filePath, b, oauth) {
  const youtube = google.youtube({ version: "v3", auth: oauth });
  const dateLabel = b.started_at
    ? new Date(b.started_at).toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
      })
    : "";
  const title = [
    `${b.home_team} vs ${b.away_team}`,
    dateLabel,
    b.tournament || "",
  ]
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
    media: {
      mimeType: "video/mp4",
      body: fs.createReadStream(filePath), // ストリーム = resumable・メモリ一定
    },
  });
  const id = res.data.id;
  if (!id) throw new Error("YouTube upload returned no video id");
  return id;
}

// googleapis / network エラーを 4 分類（web 版と同じ思想）。
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

  // 2. 配信者の適格性（¥500チーム + 自動アーカイブON + YouTube連携済み）
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

  // 3. 録画ファイル（まだ書き込み中/未生成なら retry）
  const rec = findRecording(b.share_code);
  if (!rec) {
    const endedMs = b.ended_at ? Date.parse(b.ended_at) : 0;
    const ageMs = endedMs ? Date.now() - endedMs : Infinity;
    if (ageMs > RECORDING_WAIT_MS || retry >= MAX_RETRY - 1) {
      // 終了から十分経過(録画OFF時代/取りこぼし) or リトライ上限 → 即 failed
      await setStatus(b.id, {
        youtube_upload_status: "failed",
        youtube_upload_error: "recording not found (predates recording or lost)",
        youtube_retry_count: retry,
      });
    } else {
      // 終了直後 = 録画ファイナライズ待ちの可能性 → retry
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

  // 4. 楽観排他で uploading にマーク（他 tick が先取り済みなら諦める）
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

  log("uploading", b.share_code, `${(rec.size / 1e6).toFixed(0)}MB`);
  try {
    const oauth = await getOAuthClient(
      prof.youtube_refresh_token,
      prof.youtube_access_token,
      prof.id,
    );
    // ── Phase2(③): ここで ffmpeg によるスコア焼き込みを行い、焼き込み済みファイルに差し替える ──
    const videoId = await uploadToYouTube(rec.p, b, oauth);
    await setStatus(b.id, {
      youtube_upload_status: "completed",
      youtube_video_id: videoId,
      youtube_upload_completed_at: new Date().toISOString(),
      youtube_upload_error: null,
    });
    // 成功 → ローカル録画を削除（YouTube unlisted が正本）
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
