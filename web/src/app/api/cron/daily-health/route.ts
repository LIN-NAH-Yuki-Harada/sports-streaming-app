import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import {
  cacheBuster,
  httpProbe,
  median,
  probeTwice,
  tcpProbe,
  tlsCertProbe,
} from "@/lib/health-probes";
import { recordHeartbeat } from "@/lib/ops-heartbeat";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
// 外形プローブを並列で叩くが、遅い相手が居ても打ち切れるよう余裕を持たせる。
export const maxDuration = 60;

/**
 * 毎朝の総合点検（22:00 UTC = 07:00 JST）
 *
 * 【これは何のためにあるか】
 *   2026-06-13 に Vercel の支払い失敗で本番が全停止した。そのとき誰も気づけなかった。
 *   既存の cron/alerts は「配信のエラー」しか見ておらず、サービスそのものの生死・
 *   支払い・容量・証明書・監視自身の停止を一切見ていなかった。
 *
 * 【設計の核心 = 沈黙と正常を区別する】
 *   異常がゼロでも必ず1通送る。この1通が「監視役が生きている証拠」であり、
 *   来ない日が異常。オーナーの仕事は毎朝この1通の有無を見ることだけ。
 *
 * 【監視役は2人いる】
 *   第1層(ここ)  : Vercel の中。毎朝の総合点検。
 *   第2層(VPS)   : infra/archive-worker の5分タイマーに相乗り。Vercel の生死を見る。
 *   別会社なので同時には止まらない。両方死んだら「朝のメールが来ない」で人間が気づく。
 *
 * 【絶対に守ること】
 *   - 読み取りのみ。DB への書き込みは自分の心拍1行だけ。
 *   - すべてのプローブにタイムアウト。1つ詰まっても全体を止めない。
 *   - 1つの点検が例外を投げても他は続行する（safeCheck で個別に握る）。
 */

// ── 閾値（すべて 2026-08-14 の実測に基づく。根拠をコメントに残すこと）──────────
/** cron の心拍がこれ以上古い = cron だけ死んだ。毎分 cron の30回分の猶予。 */
const CRON_STALE_MS = 30 * 60 * 1000;
/**
 * VPS ワーカー(server_metrics)の鮮度。
 * 実測(直近約4日): tick間隔は中央値5.5分 / p99 6.0分 / 最大56.2分、60分超は0回。
 * 30分だと長尺アーカイブのffmpeg変換で誤報するため 90分にする（観測期間中の誤報ゼロ）。
 */
const WORKER_STALE_MS = 90 * 60 * 1000;
/** ディスク使用率。実測16%。大会日は一時ファイルで瞬間的に膨らむので中央値で見る。 */
const DISK_NOTICE_PCT = 85;
const DISK_ALERT_PCT = 92;
/** 証明書残日数。Let's Encrypt は30日前から自動更新 = 14日切りは更新が壊れている。 */
const CERT_NOTICE_DAYS = 14;
const CERT_ALERT_DAYS = 7;
/** 決済異常。実測 past_due 1件が居座るのが平常なので、絶対値より前日比を主軸にする。 */
const BILLING_ABS_NOTICE = 3;
const BILLING_DELTA_NOTICE = 3;
/** アーカイブ滞留（終了から3時間以上経っても未処理）。実測 pending 0件。 */
const BACKLOG_NOTICE = 5;
const BACKLOG_ALERT = 15;
const BACKLOG_MIN_AGE_MS = 3 * 60 * 60 * 1000;
/**
 * アーカイブ失敗率。★実測ベースライン: 直近30日で failed 18 / completed 111 = 14%。
 * 14%が平常値なので1件ごとに鳴らすと毎日鳴って読まれなくなる。
 * 「件数」と「率」の両方を同時に満たしたときだけ鳴らす。
 */
const ARCHIVE_FAIL_COUNT_ALERT = 5;
const ARCHIVE_FAIL_RATE_ALERT = 0.5;
/** ゴースト配信（心拍が途絶えたまま live で残っている）。3層対策が効いていれば常に0。 */
const GHOST_MIN_AGE_MS = 6 * 60 * 60 * 1000;
/** 支払い方法(カード)の有効期限が近いと判断する日数。 */
const CARD_EXPIRY_NOTICE_DAYS = 60;
const CARD_EXPIRY_SUBJECT_DAYS = 30;

// ── 監視対象（env で上書き可能・既定は本番の実値）──────────────────────────
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://live-spotch.com").replace(
  /\/+$/,
  "",
);
/** MediaMTX オリジン（CloudFront を介さない生死確認） */
const ORIGIN_HOST = process.env.STREAM_HOST || "live.live-spotch.com";
/** CDN 前段。未設定なら CDN 点検はスキップ（VPS 直運用に戻している状態） */
const CDN_HOST = process.env.STREAM_PLAYBACK_HOST || "";
const RTMP_PORT = 1935;

/**
 * 支払い方法の有効期限台帳。
 * ★カード番号・下4桁は絶対に持たない。持つのは「サービス名」と「有効期限(年月)」だけ。
 * 2026-06-13 の全停止の直接原因はカード停止であり、事後検知より事前通知が本質的な対策。
 *
 * 設定方法（コード変更不要）: Vercel の環境変数 PAYMENT_METHOD_EXPIRIES に
 *   Vercel:2027-04,AWS:2026-11,Xserver:2027-04,Supabase:2026-09,LiveKit:2027-04,EAS:2027-04,Resend:2027-04,Stripe:2027-04
 * のように「サービス名:YYYY-MM」をカンマ区切りで入れる。
 */
const TRACKED_PAYMENT_SERVICES = [
  "Vercel",
  "AWS",
  "Xserver",
  "Supabase",
  "LiveKit",
  "EAS",
  "Resend",
  "Stripe",
] as const;

type Severity = "致命" | "重要" | "注意";
type Level = "ok" | "notice" | "alert" | "skip";

type Check = {
  id: string;
  label: string;
  severity: Severity;
  level: Level;
  /** 実測値（人間が読む短い文字列） */
  value: string;
  /** 何が起きているか / 利用者への影響 */
  cause?: string;
  /** オーナーがまず確認すること */
  action?: string;
  /** 技術的な詳細（開発者向け・メール末尾） */
  detail?: string;
  /** 件名に出したい短い文言（未指定なら label を使う） */
  subjectHint?: string;
  /** オーナーが対処できない項目は「対応不要・記録のみ」と明記する */
  ownerActionable?: boolean;
};

const SEVERITY_RANK: Record<Severity, number> = { 致命: 0, 重要: 1, 注意: 2 };

/** 点検1つを実行する。点検自体が例外を投げても他を巻き込まない。 */
async function safeCheck(
  id: string,
  label: string,
  severity: Severity,
  fn: () => Promise<Omit<Check, "id" | "label" | "severity">>,
): Promise<Check> {
  try {
    return { id, label, severity, ...(await fn()) };
  } catch (e) {
    // 点検コード自体の失敗はサービス障害ではない。誤って🔴にせず notice で報告する。
    return {
      id,
      label,
      severity,
      level: "notice",
      value: "点検できず",
      cause: "点検処理自体が失敗しました（サービスの異常とは限りません）。",
      detail: String(e instanceof Error ? e.message : e).slice(0, 300),
      ownerActionable: false,
    };
  }
}

/** JST の「きのう1日」を UTC の範囲で返す（07:00 JST 実行時に完全な前日が取れる）。 */
function jstYesterdayRange(now: Date) {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const startOfTodayJst = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  const startOfYesterdayJst = startOfTodayJst - 86_400_000;
  return {
    start: new Date(startOfYesterdayJst - 9 * 3600_000),
    end: new Date(startOfTodayJst - 9 * 3600_000),
    label: new Date(startOfYesterdayJst).toISOString().slice(0, 10),
  };
}

export async function GET(request: Request) {
  // Vercel Cron の認証チェック（タイミング攻撃対策・他の cron と同一）
  const authHeader = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(authHeader);
  const authorized =
    !!process.env.CRON_SECRET &&
    expectedBuf.length === actualBuf.length &&
    timingSafeEqual(expectedBuf, actualBuf);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?dry=1 でメールを送らずに結果だけ返す（動作確認用）
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";

  const now = new Date();
  const admin = getAdminClient();
  const yesterday = jstYesterdayRange(now);

  // 前回の点検で記録した値（決済異常の「前日比」に使う）。失敗しても続行。
  let prevBillingCount: number | null = null;
  try {
    const { data } = await admin
      .from("ops_heartbeat")
      .select("detail")
      .eq("name", "cron:daily-health")
      .abortSignal(AbortSignal.timeout(5000))
      .maybeSingle();
    if (data?.detail) {
      const parsed = JSON.parse(data.detail) as { billing?: number };
      if (typeof parsed.billing === "number") prevBillingCount = parsed.billing;
    }
  } catch {
    /* 初回・破損時は前日比なしで続行 */
  }

  // ── きのうの実績（メール本文のサマリに使う。点検とは別枠）─────────────
  const summary = {
    broadcasts: null as number | null,
    archiveCompleted: null as number | null,
    archiveFailed: null as number | null,
    diskUsedPct: null as number | null,
    nextCertLabel: "-",
  };

  // ── 16項目の点検（外形プローブは並列・DB は逐次）───────────────────────
  const checks: Check[] = [];

  // [1] サイトが開くか（Vercel本体・支払い停止の検知）
  const siteCheck = safeCheck("site", "サイトが開くか", "致命", async () => {
    const url = `${SITE_URL}/api/health?_=${cacheBuster()}`;
    const { result, attempts } = await probeTwice(
      () => httpProbe(url, { timeoutMs: 10_000 }),
      (r) => r.ok && r.status === 200 && !r.headers["x-vercel-error"],
    );
    const vercelError = result.headers["x-vercel-error"];
    if (result.ok && result.status === 200 && !vercelError) {
      return { level: "ok", value: `200 OK (${result.elapsedMs}ms)` };
    }
    // ★404 は「サイトは生きているが /api/health がまだデプロイされていない」。
    //   サイト停止・支払い失敗と混同して🔴にすると、本当の停止のときに信用されなくなる。
    //   404 が返ってきた時点で Vercel はルーティングを処理できている＝生きている証拠。
    if (result.ok && result.status === 404 && !vercelError) {
      return {
        level: "notice",
        value: "404（/api/health が未デプロイ）",
        cause:
          "サイト自体は応答していますが、監視用の /api/health がまだ本番にありません。サービスの障害ではありません。",
        action:
          "このPRを本番へ反映すると解消します。反映後もこの表示が続く場合だけ開発者に連絡してください。",
        detail: `${url} → 404 / ${attempts}回`,
        ownerActionable: false,
      };
    }
    // 402/403 + DEPLOYMENT_DISABLED = 支払い失敗と断定してよい（2026-06-13 の実績）
    const isBilling =
      (result.status === 402 || result.status === 403) &&
      String(vercelError ?? "").includes("DEPLOYMENT_DISABLED");
    return {
      level: "alert",
      value: result.ok ? `HTTP ${result.status}` : `到達不可: ${result.error}`,
      cause: isBilling
        ? "Vercel が「デプロイ無効」を返しています。支払い失敗でサイト全体が停止している可能性が非常に高いです。"
        : "サイトが正常な応答を返していません。視聴・配信ができない可能性があります。",
      action: isBilling
        ? "Vercel にログインし、支払い方法（カード）が失敗していないか確認してください。"
        : "https://live-spotch.com をスマホで開いてみてください。開かなければ Vercel の支払いを疑ってください。",
      detail: `${url} → ${result.status ?? result.error} / x-vercel-error=${vercelError ?? "(なし)"} / ${attempts}回連続`,
      ownerActionable: true,
    };
  });

  // [3] 視聴経路まるごと（CloudFront → VPS Caddy → MediaMTX の3段）
  const cdnCheck = safeCheck("playback_cdn", "視聴経路（CDN経由）", "致命", async () => {
    if (!CDN_HOST) {
      return {
        level: "skip",
        value: "未設定（VPS直で運用中）",
        detail: "STREAM_PLAYBACK_HOST が空のため CDN 点検はスキップ",
      };
    }
    const url = `https://${CDN_HOST}/live/__healthcheck_${cacheBuster()}__/index.m3u8`;
    // ★正常は 404。存在しないパスなので MediaMTX が 404 を返すのが健全な証拠。
    // さらに via に Caddy と cloudfront の両方が入っていること = 3段すべて生存の証拠。
    const isPass = (r: Awaited<ReturnType<typeof httpProbe>>) => {
      const via = (r.headers["via"] ?? "").toLowerCase();
      return r.ok && r.status === 404 && via.includes("caddy") && via.includes("cloudfront");
    };
    const { result, attempts } = await probeTwice(
      () => httpProbe(url, { timeoutMs: 10_000 }),
      isPass,
    );
    const via = result.headers["via"] ?? "(なし)";
    if (isPass(result)) {
      return { level: "ok", value: `404 + via:Caddy/CloudFront (${result.elapsedMs}ms)` };
    }
    const caddyMissing = !via.toLowerCase().includes("caddy");
    return {
      level: "alert",
      value: result.ok ? `HTTP ${result.status} / via: ${via}` : `到達不可: ${result.error}`,
      cause: caddyMissing
        ? "CDN から配信サーバー（VPS）へ届いていません。視聴者に映像が流れていない可能性があります。"
        : "視聴経路が正常な応答を返していません。視聴できない可能性があります。",
      action:
        "AWS(CloudFront) の支払いと、Xserver VPS が稼働中かを確認してください。サイトは開くのに映像だけ映らない、という壊れ方をします。",
      detail: `${url} → ${result.status ?? result.error} / via=${via} / ${attempts}回連続`,
      ownerActionable: true,
    };
  });

  // [4] VPS/MediaMTX 直（CloudFront を介さない生死）
  const originCheck = safeCheck("playback_origin", "配信サーバー直（VPS）", "致命", async () => {
    const url = `https://${ORIGIN_HOST}/live/__healthcheck_${cacheBuster()}__/index.m3u8`;
    const { result, attempts } = await probeTwice(
      () => httpProbe(url, { timeoutMs: 10_000 }),
      (r) => r.ok && r.status === 404,
    );
    if (result.ok && result.status === 404) {
      return { level: "ok", value: `404 (${result.elapsedMs}ms)` };
    }
    return {
      level: "alert",
      value: result.ok ? `HTTP ${result.status}` : `到達不可: ${result.error}`,
      cause:
        "配信サーバー（VPS）から応答がありません。いま配信中の試合は、視聴者に映像が届いていない可能性があります。",
      action:
        "Xserver VPS の管理画面にログインし、①支払いが失敗していないか ②サーバーが「稼働中」か を確認してください。",
      detail: `${url} → ${result.status ?? result.error} / ${attempts}回連続`,
      ownerActionable: true,
    };
  });

  // [5] 配信の受け口（RTMP 1935番）
  const rtmpCheck = safeCheck("rtmp", "配信の受け口（RTMP 1935）", "致命", async () => {
    // データは1バイトも送らない（MediaMTX のログを汚さない）。5分に1回・1接続のみ。
    const { result, attempts } = await probeTwice(
      () => tcpProbe(ORIGIN_HOST, RTMP_PORT, 3000),
      (r) => r.ok,
    );
    if (result.ok) return { level: "ok", value: `接続OK (${result.elapsedMs}ms)` };
    return {
      level: "alert",
      value: `接続不可: ${result.error}`,
      cause:
        "アプリからの配信を受け付ける入口が閉じています。新しい配信を開始できない可能性があります。",
      action:
        "他の項目（配信サーバー直）が正常ならば、MediaMTX の設定変更直後を疑ってください。",
      detail: `tcp://${ORIGIN_HOST}:${RTMP_PORT} → ${result.error} / ${attempts}回連続`,
      ownerActionable: false,
    };
  });

  // [6] Supabase（データベース）
  const supabaseCheck = safeCheck("supabase", "データベース（Supabase）", "致命", async () => {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base) {
      return { level: "notice", value: "URL未設定", ownerActionable: false };
    }
    // ★キー無しの 401 は「正常に応答している証拠」。失敗扱いにしてはいけない。
    const { result, attempts } = await probeTwice(
      () => httpProbe(`${base}/rest/v1/`, { timeoutMs: 8000 }),
      (r) => r.ok && (r.status === 200 || r.status === 401),
    );
    if (!(result.ok && (result.status === 200 || result.status === 401))) {
      return {
        level: "alert",
        value: result.ok ? `HTTP ${result.status}` : `到達不可: ${result.error}`,
        cause: "データベースに接続できません。ログイン・配信・視聴のすべてが止まります。",
        action: "Supabase のダッシュボードでプロジェクトの状態と支払いを確認してください。",
        detail: `${base}/rest/v1/ → ${result.status ?? result.error} / ${attempts}回連続`,
        ownerActionable: true,
      };
    }
    // 外形に加えて、認証付きの実クエリが通ることも確認する（1行だけ）
    const { error } = await admin
      .from("broadcasts")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(8000));
    if (error) {
      return {
        level: "alert",
        value: `応答あり(${result.status})だが実クエリ失敗`,
        cause: "データベースは応答しますが、読み取りに失敗しています。",
        action: "Supabase のダッシュボードでプロジェクトの状態を確認してください。",
        detail: error.message.slice(0, 200),
        ownerActionable: true,
      };
    }
    return { level: "ok", value: `${result.status} + 実クエリOK (${result.elapsedMs}ms)` };
  });

  // [7] LiveKit（ブラウザ配信の基盤）
  const livekitCheck = safeCheck("livekit", "LiveKit（ブラウザ配信）", "重要", async () => {
    const raw = process.env.NEXT_PUBLIC_LIVEKIT_URL || "";
    if (!raw) return { level: "skip", value: "未設定", ownerActionable: false };
    const httpUrl = raw.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
    const { result, attempts } = await probeTwice(
      () => httpProbe(`${httpUrl}/`, { timeoutMs: 8000 }),
      (r) => r.ok && r.status === 200,
    );
    if (result.ok && result.status === 200) {
      return { level: "ok", value: `200 OK (${result.elapsedMs}ms)` };
    }
    return {
      level: "alert",
      value: result.ok ? `HTTP ${result.status}` : `到達不可: ${result.error}`,
      cause:
        "ブラウザからの配信基盤(LiveKit)が応答していません。★iOS/Android アプリからの配信には影響しません。",
      action: "対応不要・記録のみ。続くようなら LiveKit の支払い($50/月)を確認してください。",
      detail: `${httpUrl}/ → ${result.status ?? result.error} / ${attempts}回連続`,
      ownerActionable: false,
    };
  });

  // [10] SSL証明書の残日数
  const certCheck = safeCheck("tls_certs", "SSL証明書の残日数", "重要", async () => {
    const hosts: { host: string; awsManaged: boolean }[] = [
      { host: new URL(SITE_URL).hostname, awsManaged: false },
      { host: ORIGIN_HOST, awsManaged: false },
      ...(CDN_HOST ? [{ host: CDN_HOST, awsManaged: true }] : []),
    ];
    const results = await Promise.all(
      hosts.map(async (h) => ({ ...h, ...(await tlsCertProbe(h.host)) })),
    );
    const readable = results.filter((r) => r.daysLeft !== null);
    if (readable.length === 0) {
      return {
        level: "notice",
        value: "証明書を読み取れず",
        detail: results.map((r) => `${r.host}: ${r.error}`).join(" / "),
        ownerActionable: false,
      };
    }
    const soonest = readable.reduce((a, b) => ((a.daysLeft ?? 0) <= (b.daysLeft ?? 0) ? a : b));
    summary.nextCertLabel = `${soonest.host}（あと${soonest.daysLeft}日）`;
    const value = readable.map((r) => `${r.host}: あと${r.daysLeft}日`).join(" / ");
    // AWS 管理(CloudFront)の証明書は自動更新なので、短くても即異常とはしない。
    const critical = readable.filter((r) => !r.awsManaged && (r.daysLeft ?? 999) < CERT_ALERT_DAYS);
    const warning = readable.filter((r) => (r.daysLeft ?? 999) < CERT_NOTICE_DAYS);
    if (critical.length > 0) {
      return {
        level: "alert",
        value,
        cause: `${critical.map((r) => r.host).join(", ")} の証明書が${CERT_ALERT_DAYS}日以内に切れます。切れるとサイトが「危険なサイト」として開けなくなります。`,
        action:
          "Let's Encrypt は30日前から自動更新します。14日を切っている＝自動更新が既に壊れています。至急確認が必要です。",
        ownerActionable: true,
      };
    }
    if (warning.length > 0) {
      return {
        level: "notice",
        value,
        cause: `${warning.map((r) => r.host).join(", ")} の証明書の残りが${CERT_NOTICE_DAYS}日を切りました。`,
        action:
          "AWS(CloudFront)の証明書は自動更新なので対応不要。それ以外は自動更新の確認が要ります。",
        ownerActionable: warning.some((r) => !r.awsManaged),
      };
    }
    return { level: "ok", value };
  });

  // 外形プローブは互いに独立なので並列で叩く（合計時間を短く保つ）
  const [site, cdn, origin, rtmp, supa, livekit, certs] = await Promise.all([
    siteCheck,
    cdnCheck,
    originCheck,
    rtmpCheck,
    supabaseCheck,
    livekitCheck,
    certCheck,
  ]);
  checks.push(site);

  // [2] Vercel の cron が動いているか（サイトは生きていても cron だけ黙る）
  checks.push(
    await safeCheck("cron_heartbeat", "定期処理（cron）の稼働", "致命", async () => {
      const { data, error } = await admin
        .from("ops_heartbeat")
        .select("name, last_run_at")
        .abortSignal(AbortSignal.timeout(8000));
      if (error) {
        // ★テーブル未作成（マイグレーション未適用）と「cron が死んだ」を混同しない。
        return {
          level: "notice",
          value: "心拍テーブルを読めず",
          cause:
            "ops_heartbeat テーブルがまだ作られていない可能性があります（マイグレーション未適用）。cron が死んだという意味ではありません。",
          action: "Supabase の SQL Editor で web/supabase-migration-ops-heartbeat.sql を実行してください。",
          detail: error.message.slice(0, 200),
          ownerActionable: true,
        };
      }
      const rows = data ?? [];
      if (rows.length === 0) {
        return {
          level: "notice",
          value: "心拍がまだ1件もない",
          cause: "テーブルはありますが、まだどの cron も心拍を書いていません（デプロイ直後など）。",
          ownerActionable: false,
        };
      }
      const ages = rows.map((r) => now.getTime() - new Date(r.last_run_at).getTime());
      const newest = Math.min(...ages);
      const newestMin = Math.round(newest / 60_000);
      const stale = rows.filter(
        (r) => now.getTime() - new Date(r.last_run_at).getTime() > CRON_STALE_MS,
      );
      if (newest > CRON_STALE_MS) {
        return {
          level: "alert",
          value: `最新の心拍が${newestMin}分前`,
          cause:
            "サイトは生きていますが、定期処理（cron）が止まっています。配信の自動終了・アーカイブ処理・障害通知がすべて止まります。",
          action: "Vercel のダッシュボードで Cron Jobs が有効か、支払いが正常かを確認してください。",
          detail: rows
            .map((r) => `${r.name}: ${Math.round((now.getTime() - new Date(r.last_run_at).getTime()) / 60_000)}分前`)
            .join(" / "),
          ownerActionable: true,
        };
      }
      if (stale.length > 0) {
        return {
          level: "notice",
          value: `${rows.length}本中${stale.length}本が${CRON_STALE_MS / 60_000}分以上停止`,
          cause: `${stale.map((s) => s.name).join(", ")} だけが動いていません。`,
          detail: rows
            .map((r) => `${r.name}: ${Math.round((now.getTime() - new Date(r.last_run_at).getTime()) / 60_000)}分前`)
            .join(" / "),
          ownerActionable: false,
        };
      }
      return { level: "ok", value: `${rows.length}本すべて稼働（最新 ${newestMin}分前）` };
    }),
  );

  checks.push(cdn, origin, rtmp, supa, livekit);

  // [8] サーバーのディスク空き容量（直近1時間の中央値でスパイクを吸収）
  checks.push(
    await safeCheck("disk", "サーバーの空き容量", "重要", async () => {
      const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const { data, error } = await admin
        .from("server_metrics")
        .select("disk_used_pct")
        .gte("created_at", since)
        .not("disk_used_pct", "is", null)
        .abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error(error.message);
      const values = (data ?? []).map((r) => Number(r.disk_used_pct));
      const med = median(values);
      if (med === null) {
        return {
          level: "notice",
          value: "直近1時間の記録なし",
          cause: "VPS からの記録が届いていません（次の項目も参照）。",
          ownerActionable: false,
        };
      }
      summary.diskUsedPct = med;
      const value = `使用 ${med}%（空き ${Math.round((100 - med) * 10) / 10}%・${values.length}件の中央値）`;
      if (med > DISK_ALERT_PCT) {
        return {
          level: "alert",
          value,
          cause:
            "サーバーの空き容量がほとんどありません。アーカイブの変換が失敗し、録画が失われる恐れがあります（過去に一時領域が溢れて長尺アーカイブが全滅した前科があります）。",
          action: "至急、開発者に連絡して不要な録画・中間ファイルの削除を依頼してください。",
          ownerActionable: true,
        };
      }
      if (med > DISK_NOTICE_PCT) {
        return {
          level: "notice",
          value,
          cause: "空き容量が減ってきています。見ておくだけで大丈夫です。",
          ownerActionable: false,
        };
      }
      return { level: "ok", value };
    }),
  );

  // [9] VPS のワーカーが生きているか（server_metrics の鮮度）
  checks.push(
    await safeCheck("worker_freshness", "配信サーバーのワーカー稼働", "重要", async () => {
      const { data, error } = await admin
        .from("server_metrics")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) {
        // ★「1件も無い」と「鮮度切れ」を必ず区別する。前者は METRICS_ENABLED 未設定。
        return {
          level: "notice",
          value: "記録が1件もない",
          cause:
            "VPS のメトリクス送信が有効になっていない可能性があります（METRICS_ENABLED 未設定）。ワーカーが死んだという意味ではありません。",
          ownerActionable: false,
        };
      }
      const ageMs = now.getTime() - new Date(rows[0].created_at).getTime();
      const ageMin = Math.round(ageMs / 60_000);
      if (ageMs > WORKER_STALE_MS) {
        return {
          level: "alert",
          value: `最新の記録が${ageMin}分前`,
          cause:
            "配信サーバー上のワーカーが止まっています。アーカイブ変換・ゴースト掃除・稼働記録がすべて止まります。",
          action: "Xserver VPS が稼働中か、支払いが失敗していないかを確認してください。",
          detail: `server_metrics 最新: ${rows[0].created_at}（閾値 ${WORKER_STALE_MS / 60_000}分）`,
          ownerActionable: true,
        };
      }
      return { level: "ok", value: `最新の記録が${ageMin}分前` };
    }),
  );

  checks.push(certs);

  // [11] 利用者の決済異常（past_due / unpaid）
  checks.push(
    await safeCheck("billing", "利用者の決済異常", "注意", async () => {
      const { count, error } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .in("subscription_status", ["past_due", "unpaid"])
        .abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error(error.message);
      const n = count ?? 0;
      const delta = prevBillingCount === null ? null : n - prevBillingCount;
      const value =
        delta === null
          ? `${n}件`
          : `${n}件（前日比 ${delta >= 0 ? "+" : ""}${delta}）`;
      // ★個々のカード期限切れは通常運用で必ず発生する（実測1件が居座るのが平常）。
      //   絶対値だけで鳴らすと毎日鳴るので、前日比の急増を主軸にする。
      if (delta !== null && delta >= BILLING_DELTA_NOTICE) {
        return {
          level: "notice",
          value,
          cause: `決済に失敗している利用者が1日で${delta}件増えました。Stripe 側の一括失敗の可能性があります。`,
          action: "見ておくだけで大丈夫です。数日続くようなら Stripe のダッシュボードを確認してください。",
          ownerActionable: false,
        };
      }
      if (n > BILLING_ABS_NOTICE) {
        return {
          level: "notice",
          value,
          cause: `決済に失敗している利用者が${n}件います。`,
          action: "見ておくだけで大丈夫です（Stripe は数日かけて自動リトライします）。",
          ownerActionable: false,
        };
      }
      return { level: "ok", value };
    }),
  );

  // [12] アーカイブの滞留（処理待ちが溜まっていないか）
  checks.push(
    await safeCheck("archive_backlog", "アーカイブの滞留", "注意", async () => {
      const cutoff = new Date(now.getTime() - BACKLOG_MIN_AGE_MS).toISOString();
      const { count, error } = await admin
        .from("broadcasts")
        .select("id", { count: "exact", head: true })
        .eq("status", "ended")
        .lt("ended_at", cutoff)
        .or("youtube_upload_status.is.null,youtube_upload_status.eq.pending")
        .abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error(error.message);
      const n = count ?? 0;
      // ★status=null は「失敗」ではなく「順番待ち」。失敗として書かないこと。
      const value = `${n}件（終了から3時間以上たっても未処理）`;
      if (n > BACKLOG_ALERT) {
        return {
          level: "alert",
          value,
          cause: "アーカイブの処理待ちが異常に溜まっています。処理が止まっている可能性があります。",
          action: "配信サーバーのワーカー稼働（上の項目）も合わせて確認してください。",
          ownerActionable: false,
        };
      }
      if (n > BACKLOG_NOTICE) {
        return {
          level: "notice",
          value,
          cause: "処理待ちがやや溜まっています（1回に1本ずつ処理する設計なので、大会日は列ができます）。",
          action: "見ておくだけで大丈夫です。",
          ownerActionable: false,
        };
      }
      return { level: "ok", value };
    }),
  );

  // [13] アーカイブの失敗率が平常を超えていないか
  checks.push(
    await safeCheck("archive_failure_rate", "アーカイブの失敗率", "重要", async () => {
      const [failedRes, completedRes] = await Promise.all([
        admin
          .from("broadcasts")
          .select("id", { count: "exact", head: true })
          .eq("youtube_upload_status", "failed")
          .gte("ended_at", yesterday.start.toISOString())
          .lt("ended_at", yesterday.end.toISOString())
          .abortSignal(AbortSignal.timeout(8000)),
        admin
          .from("broadcasts")
          .select("id", { count: "exact", head: true })
          .eq("youtube_upload_status", "completed")
          .gte("ended_at", yesterday.start.toISOString())
          .lt("ended_at", yesterday.end.toISOString())
          .abortSignal(AbortSignal.timeout(8000)),
      ]);
      if (failedRes.error) throw new Error(failedRes.error.message);
      if (completedRes.error) throw new Error(completedRes.error.message);
      const failed = failedRes.count ?? 0;
      const completed = completedRes.count ?? 0;
      summary.archiveFailed = failed;
      summary.archiveCompleted = completed;
      const total = failed + completed;
      const rate = total === 0 ? 0 : failed / total;
      const value =
        total === 0
          ? "きのうは対象なし"
          : `成功${completed}件 / 失敗${failed}件（失敗率 ${Math.round(rate * 100)}%）`;
      // ★失敗率14%が元々の平常値。1件ごとに鳴らすと毎日鳴って読まれなくなるので、
      //   「件数」と「率」の両方を同時に満たすときだけ鳴らす。
      if (failed > ARCHIVE_FAIL_COUNT_ALERT && rate > ARCHIVE_FAIL_RATE_ALERT) {
        return {
          level: "alert",
          value,
          cause:
            "アーカイブの失敗が平常の範囲を大きく超えています。YouTube 連携が壊れている可能性があります。",
          action: "配信者の YouTube 連携が切れていないか、開発者に確認を依頼してください。",
          ownerActionable: false,
        };
      }
      return { level: "ok", value: `${value}（平常は14%前後）` };
    }),
  );

  // [14] ゴースト配信（配信中のまま残っている試合）
  checks.push(
    await safeCheck("ghost", "ゴースト配信", "注意", async () => {
      const cutoff = new Date(now.getTime() - GHOST_MIN_AGE_MS).toISOString();
      // ★last_seen_at（配信者が60秒毎に更新する心拍）が新しいものは必ず除外する。
      //   started_at だけで判定すると、大会の長時間配信を誤検知する。
      const { count, error } = await admin
        .from("broadcasts")
        .select("id", { count: "exact", head: true })
        .eq("status", "live")
        .lt("started_at", cutoff)
        .or(`last_seen_at.is.null,last_seen_at.lt.${cutoff}`)
        .abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error(error.message);
      const n = count ?? 0;
      if (n >= 1) {
        return {
          level: "notice",
          value: `${n}件`,
          cause:
            "「配信中」のまま残っている試合があります。3層のゴースト対策が効いていれば通常は0件です。",
          action: "見ておくだけで大丈夫です。続くようなら開発者に連絡してください。",
          ownerActionable: false,
        };
      }
      return { level: "ok", value: "0件" };
    }),
  );

  // きのうの配信本数（サマリ用・点検項目ではない）
  try {
    const { count, error } = await admin
      .from("broadcasts")
      .select("id", { count: "exact", head: true })
      .gte("started_at", yesterday.start.toISOString())
      .lt("started_at", yesterday.end.toISOString())
      .abortSignal(AbortSignal.timeout(8000));
    // ★エラー時は count が null で返る。0 と混同すると「配信0本」と嘘の実績を報告してしまう。
    //   測れなかったことは測れなかったと分かるよう null のままにする。
    if (!error && typeof count === "number") summary.broadcasts = count;
  } catch {
    /* サマリなので失敗しても続行 */
  }

  // [15] メール送信そのものが設定されているか
  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_NOTIFICATION_EMAIL ?? process.env.CONTACT_NOTIFICATION_EMAIL;
  const emailConfigured = !!resendKey && !!to;
  checks.push({
    id: "email_config",
    label: "メール送信の設定",
    severity: "致命",
    level: emailConfigured ? "ok" : "alert",
    value: emailConfigured
      ? `設定済み（送信元: ${process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"}）`
      : `未設定（${!resendKey ? "RESEND_API_KEY" : ""}${!resendKey && !to ? " と " : ""}${!to ? "ALERT_NOTIFICATION_EMAIL" : ""} がありません）`,
    cause: emailConfigured
      ? undefined
      : "メールの設定が無いため、この点検結果もアラートも誰にも届きません。監視が完全に無音になっています。",
    action: emailConfigured
      ? undefined
      : "Vercel の環境変数に RESEND_API_KEY と ALERT_NOTIFICATION_EMAIL を設定してください。",
    ownerActionable: !emailConfigured,
  });

  // [16] 支払い方法（カード）の有効期限そのもの
  checks.push(
    await safeCheck("payment_methods", "支払い方法の有効期限", "重要", async () => {
      const raw = process.env.PAYMENT_METHOD_EXPIRIES || "";
      if (!raw.trim()) {
        return {
          level: "notice",
          value: "未登録",
          cause: `カードの有効期限台帳が未登録です。2026-06-13 の全停止はカード停止が原因でした。事後の検知より、期限切れの事前通知の方が本質的な対策です。`,
          action: `Vercel の環境変数 PAYMENT_METHOD_EXPIRIES に「サービス名:YYYY-MM」をカンマ区切りで登録してください（対象: ${TRACKED_PAYMENT_SERVICES.join(" / ")}）。カード番号は絶対に入れないでください。`,
          ownerActionable: true,
        };
      }
      const entries = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const [name, ym] = pair.split(":").map((s) => s?.trim());
          const m = /^(\d{4})-(\d{1,2})$/.exec(ym ?? "");
          if (!name || !m) return { name: name || pair, daysLeft: null as number | null };
          // カードは「その月の末日まで」有効
          const end = Date.UTC(Number(m[1]), Number(m[2]), 1);
          return { name, daysLeft: Math.floor((end - now.getTime()) / 86_400_000) };
        });
      const bad = entries.filter((e) => e.daysLeft === null);
      const expired = entries.filter((e) => (e.daysLeft ?? 1) <= 0);
      const soon = entries.filter(
        (e) => (e.daysLeft ?? 9999) > 0 && (e.daysLeft ?? 9999) < CARD_EXPIRY_NOTICE_DAYS,
      );
      const value = entries
        .map((e) => `${e.name}: ${e.daysLeft === null ? "書式エラー" : `あと${e.daysLeft}日`}`)
        .join(" / ");
      if (expired.length > 0) {
        // ★期限が過ぎた項目は消さずに鳴らし続ける（放置できない設計）
        return {
          level: "alert",
          value,
          cause: `${expired.map((e) => e.name).join(", ")} に登録したカードの有効期限が切れています（台帳の更新漏れの可能性もあります）。`,
          action:
            "各サービスにログインしてカードを更新し、そのうえで環境変数 PAYMENT_METHOD_EXPIRIES を新しい期限に直してください。",
          ownerActionable: true,
        };
      }
      if (soon.length > 0 || bad.length > 0) {
        // ★残り30日を切ったカードは件名に出す（本文に埋もれさせない）。
        //   2026-06-13 の全停止はカード停止が直接原因だった。
        const urgent = soon.filter((e) => (e.daysLeft ?? 9999) < CARD_EXPIRY_SUBJECT_DAYS);
        return {
          level: "notice",
          value,
          subjectHint:
            urgent.length > 0
              ? `${urgent[0].name}のカード期限あと${urgent[0].daysLeft}日`
              : undefined,
          cause:
            soon.length > 0
              ? `${soon.map((e) => e.name).join(", ")} のカード有効期限が${CARD_EXPIRY_NOTICE_DAYS}日以内です。`
              : "台帳の書式が読めない項目があります。",
          action:
            soon.length > 0
              ? "期限が来る前にカードを更新してください。"
              : "「サービス名:YYYY-MM」の形式で登録してください。",
          ownerActionable: true,
        };
      }
      return { level: "ok", value };
    }),
  );

  // ── 集計 ────────────────────────────────────────────────────────────
  const alerts = checks.filter((c) => c.level === "alert");
  const notices = checks.filter((c) => c.level === "notice");
  // 件名に出す「一番重い1件」。同じ深刻度なら、件名向けの文言を持つもの
  // （＝カード期限のように埋もれると困るもの）を優先する。
  const worst = [...alerts, ...notices].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.subjectHint ? 0 : 1) - (b.subjectHint ? 0 : 1),
  )[0];
  const subject = buildSubject({ now, alerts, notices, worst, summary });

  // 自分の心拍と、次回の前日比に使う値を記録（失敗しても throw しない）
  await recordHeartbeat("cron:daily-health", {
    ok: alerts.length === 0,
    detail: JSON.stringify({
      billing: await (async () => {
        const c = checks.find((x) => x.id === "billing");
        const m = /^(\d+)件/.exec(c?.value ?? "");
        return m ? Number(m[1]) : null;
      })(),
      alerts: alerts.length,
      notices: notices.length,
    }),
  });

  const payload = {
    subject,
    checkedAt: now.toISOString(),
    totalChecks: checks.length,
    alerts: alerts.length,
    notices: notices.length,
    emailConfigured,
    emailed: false as boolean,
    summary,
    checks: checks.map((c) => ({
      id: c.id,
      label: c.label,
      severity: c.severity,
      level: c.level,
      value: c.value,
    })),
  };

  // ★メール未設定なら「送ったつもり」にせず、必ず 500 を返して Vercel の cron ログに残す。
  //   既存の cron/alerts は未設定でも「通知済み」と記録して終わる既知の欠陥があるため、
  //   ここでは同じ間違いを繰り返さない。
  if (!emailConfigured) {
    console.error(
      "[cron/daily-health] メール未設定のため送信していません。RESEND_API_KEY と ALERT_NOTIFICATION_EMAIL(または CONTACT_NOTIFICATION_EMAIL) を設定してください。",
      JSON.stringify(payload),
    );
    return Response.json({ ...payload, error: "email_not_configured" }, { status: 500 });
  }

  if (dryRun) {
    // 送らずに「実際に届く本文」をそのまま返す（メールを汚さずに中身を確認できる）
    console.info("[cron/daily-health] dry run:", subject);
    return Response.json({
      ...payload,
      dryRun: true,
      textPreview: buildText({ now, checks, alerts, notices, summary }),
    });
  }

  try {
    const result = await new Resend(resendKey).emails.send({
      from: process.env.RESEND_FROM_EMAIL || "LIVE SPOtCH <onboarding@resend.dev>",
      to: [to],
      subject,
      html: buildHtml({ now, checks, alerts, notices, summary }),
      text: buildText({ now, checks, alerts, notices, summary }),
    });
    if (result.error) throw new Error(result.error.message);
    payload.emailed = true;
    console.info("[cron/daily-health] sent:", subject);
  } catch (e) {
    console.error("[cron/daily-health] メール送信に失敗しました:", e);
    return Response.json(
      { ...payload, error: "email_send_failed", detail: String(e).slice(0, 300) },
      { status: 500 },
    );
  }

  return Response.json(payload);
}

// ── 件名・本文の組み立て ────────────────────────────────────────────────

type Summary = {
  broadcasts: number | null;
  archiveCompleted: number | null;
  archiveFailed: number | null;
  diskUsedPct: number | null;
  nextCertLabel: string;
};

function jstDateLabel(d: Date) {
  const jst = new Date(d.getTime() + 9 * 3600_000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

function jstFullLabel(d: Date) {
  const jst = new Date(d.getTime() + 9 * 3600_000);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()];
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日(${wd}) ${hh}:${mm}`;
}

/**
 * 件名は「絵文字を先頭1文字目に固定」「日付を必ず入れる」「一番重い1件だけ出す」。
 * ★この書式は絶対に変えないこと。Gmail のフィルタ（件名に ✅ を含む → 既読）が作れなくなる。
 */
function buildSubject(args: {
  now: Date;
  alerts: Check[];
  notices: Check[];
  worst: Check | undefined;
  summary: Summary;
}) {
  const { now, alerts, notices, worst, summary } = args;
  const date = jstDateLabel(now);
  if (alerts.length > 0) {
    return `🔴 LIVE SPOtCH 異常${alerts.length}件 ${date}｜${worst?.subjectHint ?? worst?.label ?? ""}`;
  }
  if (notices.length > 0) {
    return `🟡 LIVE SPOtCH 注意${notices.length}件 ${date}｜${worst?.subjectHint ?? worst?.label ?? ""}`;
  }
  const bits: string[] = [];
  if (summary.broadcasts !== null) bits.push(`配信${summary.broadcasts}本`);
  if (summary.diskUsedPct !== null) bits.push(`ディスク${summary.diskUsedPct}%`);
  return `✅ LIVE SPOtCH 正常 ${date}${bits.length ? `｜${bits.join("・")}` : ""}`;
}

function escapeHtml(s: string) {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

const LEVEL_MARK: Record<Level, string> = {
  ok: "✅",
  notice: "🟡",
  alert: "🔴",
  skip: "－",
};

function summaryLines(summary: Summary) {
  const lines: string[] = [];
  if (summary.broadcasts !== null) {
    const arch =
      summary.archiveCompleted !== null && summary.archiveFailed !== null
        ? ` / アーカイブ成功 ${summary.archiveCompleted}本・失敗 ${summary.archiveFailed}本（平常の範囲）`
        : "";
    lines.push(`配信 ${summary.broadcasts}本${arch}`);
  }
  if (summary.diskUsedPct !== null) {
    lines.push(`サーバーの空き容量 ${Math.round((100 - summary.diskUsedPct) * 10) / 10}%`);
  }
  lines.push(`次に切れる証明書：${summary.nextCertLabel}`);
  return lines;
}

function buildText(args: {
  now: Date;
  checks: Check[];
  alerts: Check[];
  notices: Check[];
  summary: Summary;
}) {
  const { now, checks, alerts, notices, summary } = args;
  const out: string[] = [];
  out.push(`LIVE SPOtCH 稼働レポート  ${jstFullLabel(now)}`);
  out.push("");
  if (alerts.length === 0 && notices.length === 0) {
    out.push("✅ すべて正常です。対応は不要です。");
  } else if (alerts.length > 0) {
    out.push(`🔴 異常が${alerts.length}件あります。`);
  } else {
    out.push(`🟡 注意が${notices.length}件あります（対応不要・見ておくだけ）。`);
  }
  out.push("");
  out.push("きのうの実績");
  for (const l of summaryLines(summary)) out.push(`  ${l}`);
  for (const c of [...alerts, ...notices]) {
    out.push("");
    out.push(`${LEVEL_MARK[c.level]} ${c.label}（${c.severity}）: ${c.value}`);
    if (c.cause) out.push(`  【何が起きているか】${c.cause}`);
    if (c.action) out.push(`  【まず確認すること】${c.action}`);
    if (c.ownerActionable === false) out.push("  （対応不要・記録のみ）");
    if (c.detail) out.push(`  【技術詳細】${c.detail}`);
  }
  out.push("");
  out.push("──────────");
  out.push(`点検した${checks.length}項目`);
  for (const c of checks) {
    out.push(`  ${LEVEL_MARK[c.level]} ${c.label}: ${c.value}`);
  }
  out.push("");
  out.push("このメールは毎朝7:00に必ず届きます。届かない日は監視自体が止まっている可能性があります。");
  return out.join("\n");
}

function buildHtml(args: {
  now: Date;
  checks: Check[];
  alerts: Check[];
  notices: Check[];
  summary: Summary;
}) {
  const { now, checks, alerts, notices, summary } = args;
  const headerColor = alerts.length > 0 ? "#e63946" : notices.length > 0 ? "#d98324" : "#2a9d8f";
  const headline =
    alerts.length > 0
      ? `🔴 異常が${alerts.length}件あります。`
      : notices.length > 0
        ? `🟡 注意が${notices.length}件あります。<span style="font-weight:400;color:#666;">（対応不要・見ておくだけ）</span>`
        : "✅ すべて正常です。対応は不要です。";

  // 異常・注意は「何が起きたか → 利用者への影響 → まずやること」を最初に、技術詳細は最後に。
  const problems = [...alerts, ...notices]
    .map((c) => {
      const rows: string[] = [];
      if (c.cause) {
        rows.push(
          `<div style="margin-top:10px;"><b>【何が起きているか】</b><br>${escapeHtml(c.cause)}</div>`,
        );
      }
      if (c.action) {
        rows.push(
          `<div style="margin-top:10px;"><b>【まず確認すること】</b><br>${escapeHtml(c.action)}</div>`,
        );
      }
      if (c.ownerActionable === false) {
        rows.push(
          `<div style="margin-top:10px;color:#666;">この項目はオーナー側で対処できません。<b>対応不要・記録のみ</b>です。</div>`,
        );
      }
      if (c.detail) {
        rows.push(
          `<div style="margin-top:10px;color:#888;font-size:12px;font-family:monospace;word-break:break-all;">【技術的な詳細（開発者向け）】<br>${escapeHtml(c.detail)}</div>`,
        );
      }
      return `<div style="margin-top:16px;background:${c.level === "alert" ? "#fff5f5" : "#fffaf0"};border-left:4px solid ${c.level === "alert" ? "#e63946" : "#d98324"};border-radius:6px;padding:14px 16px;font-size:14px;">
        <div style="font-weight:700;">${LEVEL_MARK[c.level]} ${escapeHtml(c.label)}<span style="font-weight:400;color:#888;font-size:12px;"> ／ ${escapeHtml(c.severity)}</span></div>
        <div style="margin-top:4px;color:#555;">実測値: ${escapeHtml(c.value)}</div>
        ${rows.join("")}
      </div>`;
    })
    .join("");

  const allRows = checks
    .map(
      (c) => `<tr>
        <td style="padding:4px 8px;white-space:nowrap;">${LEVEL_MARK[c.level]}</td>
        <td style="padding:4px 8px;">${escapeHtml(c.label)}</td>
        <td style="padding:4px 8px;color:#666;">${escapeHtml(c.value)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <div style="background:${headerColor};color:#fff;padding:16px 24px;">
      <div style="font-size:14px;font-weight:600;letter-spacing:0.02em;">LIVE SPOtCH 稼働レポート</div>
      <div style="font-size:11px;opacity:0.9;margin-top:2px;">${escapeHtml(jstFullLabel(now))}</div>
    </div>
    <div style="padding:24px;color:#1a1a1a;line-height:1.7;">
      <p style="margin:0;font-size:16px;font-weight:700;">${headline}</p>

      <div style="margin-top:18px;font-size:14px;">
        <div style="font-weight:700;">きのうの実績</div>
        ${summaryLines(summary)
          .map((l) => `<div style="margin-top:4px;color:#444;">${escapeHtml(l)}</div>`)
          .join("")}
      </div>

      ${problems}

      <div style="margin-top:28px;border-top:1px solid #eee;padding-top:16px;">
        <div style="font-size:12px;color:#888;">点検した${checks.length}項目（正常時は読まなくて大丈夫です）</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">${allRows}</table>
      </div>

      <p style="margin-top:24px;font-size:12px;color:#888;line-height:1.8;">
        このメールは<b>毎朝7:00に必ず1通</b>届きます。異常が無くても届きます。<br>
        <b>届かない日があれば、監視の仕組み自体が止まっている可能性があります。</b>
        その場合は <a href="${escapeHtml(SITE_URL)}" style="color:#666;">${escapeHtml(SITE_URL)}</a> をスマホで開いてみてください。
        開かなければ Vercel の支払いを疑ってください。
      </p>
    </div>
  </div>
</body></html>`;
}
