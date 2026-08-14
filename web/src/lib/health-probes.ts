import net from "node:net";
import tls from "node:tls";

/**
 * 外形監視の低レベルプローブ（HTTP / TCP / TLS証明書）
 *
 * 設計の約束:
 * - すべて読み取りのみ。相手のサービスに一切書き込まない。
 * - すべてタイムアウト必須。1つ詰まっても全体が止まらない。
 * - 例外は投げず、必ず結果オブジェクトを返す（呼び出し側で個別に握り潰す必要をなくす）。
 * - 「2回連続で失敗して初めて異常」を probeTwice() で担保する。
 *   一時的な 5xx やエッジの瞬断で毎朝 🔴 が出ると、肝心なときに読まれなくなる。
 */

export type HttpProbe = {
  ok: boolean;
  status: number | null;
  headers: Record<string, string>;
  elapsedMs: number;
  error: string | null;
};

/** HTTP の HEAD/GET を1回だけ叩く。例外は投げない。 */
export async function httpProbe(
  url: string,
  opts: { method?: "GET" | "HEAD"; timeoutMs?: number } = {},
): Promise<HttpProbe> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      // CDN にも Next の fetch キャッシュにも絶対に乗せない
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { "User-Agent": "live-spotch-healthcheck/1.0" },
    });
    // ボディは読まない（不要な転送とメモリを避ける）。
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return {
      ok: true,
      status: res.status,
      headers,
      elapsedMs: Date.now() - started,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      headers: {},
      elapsedMs: Date.now() - started,
      error: String(e instanceof Error ? e.message : e).slice(0, 200),
    };
  }
}

/**
 * 「2回連続で失敗したときだけ異常」を実装する共通ラッパ。
 * 1回目が合格ならそのまま返す（無駄な2回目を叩かない＝相手に優しい）。
 */
export async function probeTwice<T>(
  run: () => Promise<T>,
  isPass: (r: T) => boolean,
  gapMs = 2000,
): Promise<{ result: T; passed: boolean; attempts: number }> {
  const first = await run();
  if (isPass(first)) return { result: first, passed: true, attempts: 1 };
  await new Promise((r) => setTimeout(r, gapMs));
  const second = await run();
  return { result: second, passed: isPass(second), attempts: 2 };
}

/**
 * TCP ポートに接続できるかだけを見る（データは1バイトも送らない）。
 * MediaMTX の RTMP 受け口(1935)の生死確認に使う。ログを汚さないよう即座に閉じる。
 */
export function tcpProbe(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<{ ok: boolean; elapsedMs: number; error: string | null }> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const done = (ok: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, elapsedMs: Date.now() - started, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, null));
    socket.once("timeout", () => done(false, `timeout after ${timeoutMs}ms`));
    socket.once("error", (e) => done(false, String(e.message).slice(0, 200)));
    try {
      socket.connect(port, host);
    } catch (e) {
      done(false, String(e instanceof Error ? e.message : e).slice(0, 200));
    }
  });
}

/** SSL証明書の残日数を取得する。失敗時は daysLeft=null。 */
export function tlsCertProbe(
  host: string,
  port = 443,
  timeoutMs = 8000,
): Promise<{ ok: boolean; daysLeft: number | null; validTo: string | null; error: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (
      ok: boolean,
      daysLeft: number | null,
      validTo: string | null,
      error: string | null,
    ) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      resolve({ ok, daysLeft, validTo, error });
    };
    const socket = tls.connect(
      { host, port, servername: host, timeout: timeoutMs },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            done(false, null, null, "no certificate returned");
            return;
          }
          const expiry = new Date(cert.valid_to).getTime();
          if (Number.isNaN(expiry)) {
            done(false, null, cert.valid_to, "unparsable valid_to");
            return;
          }
          const daysLeft = Math.floor((expiry - Date.now()) / 86_400_000);
          done(true, daysLeft, cert.valid_to, null);
        } catch (e) {
          done(false, null, null, String(e instanceof Error ? e.message : e).slice(0, 200));
        }
      },
    );
    socket.once("timeout", () => done(false, null, null, `timeout after ${timeoutMs}ms`));
    socket.once("error", (e) => done(false, null, null, String(e.message).slice(0, 200)));
  });
}

/** キャッシュを必ず貫通させるための使い捨てトークン。 */
export function cacheBuster() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 数値配列の中央値（空なら null）。瞬間的なスパイクを吸収するために使う。 */
export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
