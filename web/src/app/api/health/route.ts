import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
// ★絶対にキャッシュさせない。ここがキャッシュされると「死んでいるのに 200 が返る」
//   という監視として最悪の壊れ方をする（トップページは実測で x-vercel-cache: HIT age 40187）。
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 公開ヘルスチェック（VPS のウォッチドッグが5分毎に叩く）
 *
 * 【返すもの】真偽値と時刻だけ。
 * 【返さないもの】環境変数・件数・ユーザー情報・エラーの中身。
 *   公開エンドポイントなので、攻撃面を増やさないため中身を意図的に貧しくしている。
 *
 * 【HTTPステータスの約束】★重要
 *   この関数が動く限り常に 200 を返す。DB が落ちていても 200 + ok:false。
 *   理由: ウォッチドッグは「HTTPステータス」で "Vercel(サイト)が死んだ" を判定する。
 *   DB の一時不調でサイト停止と誤報させないため、両者を別の信号として分離する。
 *   - サイトの生死      → HTTP ステータス / x-vercel-error ヘッダ
 *   - cron の生死       → newestCronAgeSec
 *   - DB の生死         → dbOk
 */

// ops_heartbeat は cron 1本につき1行しか無い（name が主キー）。
// 固定コストに保つため上限を明示する（DoS で課金が膨らまないように）。
const MAX_ROWS = 20;

export async function GET() {
  const now = new Date();
  const body: {
    ok: boolean;
    now: string;
    dbOk: boolean;
    cronCount: number;
    newestCronAgeSec: number | null;
  } = {
    ok: false,
    now: now.toISOString(),
    dbOk: false,
    cronCount: 0,
    newestCronAgeSec: null,
  };

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("ops_heartbeat")
      .select("name, last_run_at, ok")
      .limit(MAX_ROWS)
      .abortSignal(AbortSignal.timeout(5000));
    if (error) {
      // テーブル未作成（マイグレーション未適用）もここ。詳細は返さずログにだけ出す。
      console.warn("[api/health] ops_heartbeat select failed:", error.message);
    } else {
      body.dbOk = true;
      let newest: number | null = null;
      for (const row of data ?? []) {
        // ★"cron:" で始まる行だけを数える。
        //   ここに vps:watchdog（VPS 自身の心拍）を混ぜると、Vercel の cron が全滅していても
        //   自分の心拍で newestCronAgeSec が新しくなり、cron の死を永久に見逃す（自己参照）。
        if (!String(row.name).startsWith("cron:")) continue;
        const t = new Date(row.last_run_at).getTime();
        if (Number.isNaN(t)) continue;
        const ageSec = Math.max(0, Math.round((now.getTime() - t) / 1000));
        body.cronCount += 1;
        if (newest === null || ageSec < newest) newest = ageSec;
      }
      body.newestCronAgeSec = newest;
    }
  } catch (e) {
    console.warn("[api/health] failed:", String(e).slice(0, 200));
  }

  // ok = 「サイトが動いていて、DB も読めて、心拍が1本以上ある」
  body.ok = body.dbOk && body.newestCronAgeSec !== null;

  return Response.json(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}
