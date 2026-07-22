#!/usr/bin/env bash
# ============================================================================
# LIVE SPOtCH VPS 負荷ワンショット診断（2026-07-22）
# 目的: ライブ配信の「カクつき」の真因が【回線(NIC上り帯域)】か【ディスクIO】かを1回で確定。
#       → 回線が犯人なら CDN前段 / YouTube視聴誘導、ディスクが犯人なら ワーカー別マシン分離。
#
# 使い方（VPSで root で実行。できれば "カクついている最中" に）:
#     bash /opt/archive-worker/diagnose-vps-load.sh
#   事前1回だけ（未導入なら）:  apt-get update && apt-get install -y iftop sysstat
#
# 出力は画面表示＋ /tmp に保存。その内容をオーナー/開発へ共有すれば真因が確定する。
# 読み方（末尾に自動表示）:
#   [1] NIC上り が 実効70%以上で張付く  → 帯域が犯人 → CDN前段 or YouTube視聴誘導（VPS増強は無効）
#   [2] iostat の %util が 80%以上で張付く → ディスクが犯人 → アーカイブワーカー別マシン分離
# ============================================================================
set -u

OUT="/tmp/spotch-load-$(date +%Y%m%d-%H%M%S).txt"
MEDIAMTX_API="${MEDIAMTX_API_URL:-http://127.0.0.1:9997}"
NIC="$(ip route 2>/dev/null | awk '/^default/{print $5; exit}')"

{
  echo "==================== LIVE SPOtCH VPS load @ $(date '+%Y-%m-%d %H:%M:%S %Z') ===================="
  echo "host=$(hostname)  NIC(default)=${NIC:-unknown}  uptime/load:$(uptime | sed 's/.*load average/ load/')"
  echo

  echo "==== [1] NIC 上り帯域（iftop 5秒スナップショット・上り=TX/send に注目）===="
  if command -v iftop >/dev/null 2>&1; then
    iftop -t -s 5 -N -n ${NIC:+-i "$NIC"} 2>/dev/null | sed -n '1,28p'
  else
    echo "iftop 未導入 → 事前導入:  apt-get install -y iftop"
    if command -v vnstat >/dev/null 2>&1; then echo "-- 代替 vnstat 5秒 --"; vnstat -tr 5 2>/dev/null; else echo "(vnstat も無し)"; fi
  fi
  echo

  echo "==== [2] ディスクIO（iostat -x 1 を5回・各デバイスの %util 列＝100%に近いほど飽和）===="
  if command -v iostat >/dev/null 2>&1; then
    iostat -x 1 5 2>/dev/null | grep -vE '^[[:space:]]*$'
  else
    echo "iostat 未導入 → 事前導入:  apt-get install -y sysstat"
    echo "-- 代替 /proc/diskstats(生値) --"; grep -vE 'loop|ram' /proc/diskstats 2>/dev/null | awk '{print $3}' | head
  fi
  echo

  echo "==== [3] CPU/ロード（top 1回・%Cpu と負荷の高いプロセス）===="
  top -bn1 2>/dev/null | sed -n '1,14p'
  echo

  echo "==== [4] MediaMTX 現在の“実配信”本数（API）===="
  curl -s --max-time 3 "${MEDIAMTX_API}/v3/paths/list" 2>/dev/null \
    | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); items=d.get("items",[])
    live=[p for p in items if p.get("ready") and p.get("source")]
    print("総パス %d / 配信中(ready+source) %d" % (len(items), len(live)))
    for p in live:
        src=p.get("source") or {}
        print("   -", p.get("name"), "src=", src.get("type") if isinstance(src,dict) else src)
except Exception as e:
    print("  parse不可:", e)' 2>/dev/null \
    || echo "  MediaMTX API 到達不可（mediamtx.yml の api: yes / apiAddress 127.0.0.1:9997 を確認）"
  echo

  echo "==== [5] ディスク使用率 ===="
  df -h / /var /var/tmp 2>/dev/null | grep -vE 'tmpfs|udev'
  echo

  echo "==== [6] アーカイブワーカーの現在（変換が走っているか）===="
  echo "service: $(systemctl is-active archive-worker.service 2>/dev/null)  timer: $(systemctl is-active archive-worker.timer 2>/dev/null)"
  pgrep -a ffmpeg 2>/dev/null | sed 's/^/  ffmpeg: /' | head -3 || echo "  ffmpeg プロセスなし"
  echo "-- 直近 journal(8行) --"
  journalctl -u archive-worker.service -n 8 --no-pager 2>/dev/null | tail -8
  echo

  echo "==================== END ===================="
} | tee "$OUT"

echo
echo ">>> 保存先: $OUT"
echo ">>> 判定: [1]NIC上り(TX)が実効70%以上で張付く=帯域が犯人→CDN/YouTube誘導 ／ [2]%utilが80%以上張付き=ディスクが犯人→ワーカー分離"
echo ">>> この出力をオーナー/開発へ共有してください。"
