# LIVE SPOtCH チラシ裏面「使い方ガイド」 A4 1枚 PDF
#
# 表面（黒地・赤アクセント・白文字）と対になる裏面。
#
# ★設計方針
#   - **文字は最小限**。説明はスクリーンショットに担わせる（2026-08-25 オーナー指示）
#   - スクショは後から差し込む。差し込み口を SHOTS で定義し、破線の枠で可視化してある
#   - 「アーカイブが残らない」原因3つは実データで確定しているため、黄色の枠で最優先に置く
#
# ★スクショの差し込み方
#   1) 画像を docs/assets/ に置く（例 docs/assets/shot_broadcast_tab.png）
#   2) 下の SHOTS の該当行の file= にパスを書く
#   3) python3 create_flyer_back.py で再生成
#   ※ file= が空のあいだは破線のプレースホルダーが描かれる（印刷前に必ず埋めること）
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
JP = "HeiseiKakuGo-W5"

BG      = HexColor("#000000")
CARD    = HexColor("#141414")
CARD_LN = HexColor("#2c2c2c")
ACCENT  = HexColor("#e63946")
YELLOW  = HexColor("#ffe14d")
WHITE   = HexColor("#ffffff")
GRAY1   = HexColor("#c9c9c9")
GRAY2   = HexColor("#8f8f8f")
GRAY3   = HexColor("#5a5a5a")
SLOT    = HexColor("#3a3a3a")
SLOT_BG = HexColor("#0d0d0d")
GREEN   = HexColor("#4ade80")

BASE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(BASE, "LIVE_SPOtCH_チラシ裏面_使い方.pdf")

# ─── スクショ差し込み口（file を埋めると画像に差し替わる） ───────────────
SHOTS = {
    "broadcast_tab":  {"file": "", "caption": "「配信」タブ"},
    "match_input":    {"file": "", "caption": "試合の情報を入れる"},
    "scoreboard":     {"file": "", "caption": "配信中のスコアボード"},
    "youtube_link":   {"file": "", "caption": "マイページのYouTube連携"},
}

W, H = A4
M  = 34.0
CW = W - M * 2
c = canvas.Canvas(OUT, pagesize=A4)
c.setFillColor(BG)
c.rect(0, 0, W, H, stroke=0, fill=1)


def wrap(text, font, size, max_w):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur); cur = ""; continue
        if pdfmetrics.stringWidth(cur + ch, font, size) > max_w and cur:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def para(x, y, text, size=8.6, color=GRAY1, max_w=CW - 28, leading=None, font=JP):
    leading = leading or size * 1.5
    c.setFont(font, size); c.setFillColor(color)
    for ln in wrap(text, font, size, max_w):
        c.drawString(x, y, ln); y -= leading
    return y


def card(y_top, height):
    c.setFillColor(CARD); c.setStrokeColor(CARD_LN); c.setLineWidth(0.6)
    c.roundRect(M, y_top - height, CW, height, 5, stroke=1, fill=1)


def chapter(num, title, y):
    c.setFillColor(ACCENT)
    c.circle(M + 22, y + 3.4, 8.6, stroke=0, fill=1)
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(M + 22, y + 0.6, num)
    c.setFillColor(WHITE); c.setFont(JP, 13)
    c.drawString(M + 40, y, title)
    return y - 18


def shot(key, x, y_top, w, h):
    """スクショの差し込み口。file が空なら破線のプレースホルダーを描く。"""
    s = SHOTS[key]
    path = os.path.join(BASE, s["file"]) if s["file"] else ""
    if path and os.path.exists(path):
        c.drawImage(ImageReader(path), x, y_top - h, width=w, height=h,
                    preserveAspectRatio=True, anchor="c", mask="auto")
        c.setStrokeColor(CARD_LN); c.setLineWidth(0.6); c.setDash()
        c.roundRect(x, y_top - h, w, h, 3, stroke=1, fill=0)
    else:
        c.setFillColor(SLOT_BG); c.setStrokeColor(SLOT); c.setLineWidth(0.9)
        c.setDash(3, 3)
        c.roundRect(x, y_top - h, w, h, 3, stroke=1, fill=1)
        c.setDash()
        c.setFillColor(SLOT); c.setFont(JP, 8)
        c.drawCentredString(x + w / 2, y_top - h / 2 + 4, "スクリーンショット")
        c.setFont(JP, 7)
        c.drawCentredString(x + w / 2, y_top - h / 2 - 7, "（あとで差し込み）")
    c.setFillColor(GRAY2); c.setFont(JP, 7.4)
    c.drawCentredString(x + w / 2, y_top - h - 10, s["caption"])


# ══════════════ ヘッダー ══════════════
y = H - 40
c.setFillColor(ACCENT); c.roundRect(M, y - 8, 34, 15, 2, stroke=0, fill=1)
c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 8.5)
c.drawCentredString(M + 17, y - 4.2, "LIVE")
c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 14)
c.drawString(M + 40, y - 4.2, "LIVE SPOtCH")
c.setFillColor(GRAY2); c.setFont(JP, 8.5)
c.drawRightString(W - M, y - 4.2, "はじめての方へ")
c.setStrokeColor(HexColor("#333333")); c.setLineWidth(0.6)
c.line(M, y - 17, W - M, y - 17)

c.setFillColor(WHITE); c.setFont(JP, 20)
c.drawString(M, H - 85, "見る人はアプリ不要。配信は5ステップ。")

# ══════════════ 01 見る ══════════════
y = H - 105
card(y, 50)
y = chapter("1", "試合を見る", y - 20)
para(M + 14, y, "届いた共有リンクを開くだけ。会員登録もアプリもいりません。", size=9)

# ══════════════ 02 配信する ══════════════
y = H - 167
card(y, 226)
y = chapter("2", "試合を配信する", y - 20)
c.setFillColor(YELLOW); c.setFont(JP, 8.2)
c.drawString(M + 14, y + 2, "スマホからは必ずアプリで。画質が安定し、長い試合でも途切れにくくなります。")
y -= 16

for i, t in enumerate([
    "アプリの「配信」タブを開く",
    "チーム名・大会名・競技を入れる",
    "配信開始 → 出てきた共有コードをLINEで送る",
    "得点はスコアボードで動かす",
    "終わったら必ず「終了」を押す（アプリを閉じるだけでは終わりません）",
], 1):
    c.setFillColor(ACCENT); c.setFont("Helvetica-Bold", 8.4)
    c.drawString(M + 16, y, str(i))
    c.setFillColor(WHITE if i != 5 else YELLOW); c.setFont(JP, 9.2)
    c.drawString(M + 27, y, t)
    y -= 13.2

# スクショ3枚（横向き 16:9）
y -= 8
gap = 10
sw = (CW - 28 - gap * 2) / 3
sh = sw * 9 / 16
for k, i in (("broadcast_tab", 0), ("match_input", 1), ("scoreboard", 2)):
    shot(k, M + 14 + (sw + gap) * i, y, sw, sh)

# ══════════════ 03 残す ══════════════
y = H - 405
CH3 = 182
card(y, CH3)
SW3 = 86
TXT_W = CW - 28 - SW3 - 16
y2 = chapter("3", "試合を録画として残す", y - 20)
y2 = para(M + 14, y2, "ご自身のYouTubeに「限定公開」で自動保存されます。チームプラン（月額500円）と、"
                      "次の3つの準備が必要です。", size=8.6, max_w=TXT_W)
y2 -= 6
for i, (t, sub) in enumerate([
    ("マイページでYouTube連携", "ブラウザで live-spotch.com から"),
    ("youtube.com/verify で電話番号確認", "15分を超える試合に必須"),
    ("ライブ配信を有効化", "ブラウザ配信の方のみ・最大24時間"),
], 1):
    c.setFillColor(YELLOW); c.setFont("Helvetica-Bold", 8.4)
    c.drawString(M + 16, y2, str(i))
    c.setFillColor(WHITE); c.setFont(JP, 9)
    c.drawString(M + 27, y2, t)
    c.setFillColor(GRAY2); c.setFont(JP, 7.6)
    c.drawString(M + 27 + pdfmetrics.stringWidth(t, JP, 9) + 8, y2, sub)
    y2 -= 15

# 黄色の注意帯
y2 -= 2
c.setFillColor(HexColor("#241f05")); c.setStrokeColor(YELLOW); c.setLineWidth(0.8)
c.roundRect(M + 14, y2 - 22, TXT_W, 28, 3, stroke=1, fill=1)
c.setFillColor(YELLOW); c.setFont(JP, 8.4)
c.drawString(M + 24, y2 - 4, "録画が残らない原因は、ほぼこの3つ。")
c.setFillColor(GRAY1); c.setFont(JP, 7.6)
c.drawString(M + 24, y2 - 15, "大事な試合の前日までに、一度ご確認ください。")

# 右にスクショ1枚（縦）
shot("youtube_link", W - M - 14 - SW3, y - 14, SW3, CH3 - 42)

# ══════════════ 下段2カラム ══════════════
yb = H - 599
BOT_H = 158
COL_W = (CW - 14) / 2
LX, RX = M, M + COL_W + 14

# ── 左：料金 ──
c.setFillColor(CARD); c.setStrokeColor(CARD_LN); c.setLineWidth(0.6)
c.roundRect(LX, yb - BOT_H, COL_W, BOT_H, 5, stroke=1, fill=1)
yy = yb - 20
c.setFillColor(WHITE); c.setFont(JP, 12)
c.drawString(LX + 14, yy, "料金")
c.setFillColor(GRAY2); c.setFont(JP, 7.8)
c.drawString(LX + 14 + 32, yy, "見る人はずっと無料です")
yy -= 22

for name, price, feat, pick in [
    ("見る人", "無料", "ライブ・アーカイブ視聴", False),
    ("配信のみ", "300円/月", "無制限ライブ配信・スコアボード", False),
    ("チームプラン", "500円/月", "＋YouTube自動保存・チーム管理", True),
]:
    if pick:
        c.setFillColor(HexColor("#1d1011")); c.setStrokeColor(ACCENT); c.setLineWidth(0.9)
        c.roundRect(LX + 12, yy - 20, COL_W - 24, 30, 3, stroke=1, fill=1)
    c.setFillColor(ACCENT if pick else GRAY2); c.setFont(JP, 8.4)
    c.drawString(LX + 20, yy, name)
    c.setFillColor(WHITE); c.setFont(JP, 11)
    c.drawRightString(LX + COL_W - 20, yy - 0.5, price)
    c.setFillColor(GRAY1); c.setFont(JP, 7.6)
    c.drawString(LX + 20, yy - 12, feat)
    yy -= 34

c.setFillColor(YELLOW); c.setFont(JP, 7.8)
c.drawString(LX + 14, yy + 4, "はじめての方は累計10分まで無料でお試しできます。")

# ── 右：困ったときは ──
c.setFillColor(CARD); c.setStrokeColor(CARD_LN); c.setLineWidth(0.6)
c.roundRect(RX, yb - BOT_H, COL_W, BOT_H, 5, stroke=1, fill=1)
yy = yb - 20
c.setFillColor(WHITE); c.setFont(JP, 12)
c.drawString(RX + 14, yy, "困ったときは")
yy -= 20

for q, a in [
    ("音が出ない", "画面の音量ボタンを一度タップ（最初は消音）"),
    ("映像が真っ黒", "LINE内なら右上から「ブラウザで開く」"),
    ("録画が出てこない", "試合と同じくらいの時間がかかります"),
    ("配信が途中で切れた", "撮影中は他のアプリに切り替えない"),
]:
    c.setFillColor(ACCENT); c.setFont("Helvetica-Bold", 7.8)
    c.drawString(RX + 14, yy, "Q")
    c.setFillColor(WHITE); c.setFont(JP, 8.8)
    c.drawString(RX + 23, yy, q)
    yy -= 11
    yy = para(RX + 23, yy, a, size=7.6, color=GRAY2, max_w=COL_W - 40, leading=9.6)
    yy -= 6

# ══════════════ フッター ══════════════
c.setStrokeColor(HexColor("#333333")); c.setLineWidth(0.6)
c.line(M, 46, W - M, 46)
c.setFillColor(GRAY2); c.setFont(JP, 7.8)
c.drawString(M, 33, "ご不明な点は、アプリのマイページ内「お問い合わせ」から。")
c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 9)
c.drawRightString(W - M, 33, "live-spotch.com")
c.setFillColor(GRAY3); c.setFont(JP, 7)
c.drawRightString(W - M, 22, "Produced by LIN-NAH Inc.")

c.showPage()
c.save()

missing = [k for k, v in SHOTS.items() if not v["file"]]
print("生成しました:", OUT)
if missing:
    print("★スクショ未設定（印刷前に埋めてください）:", ", ".join(missing))
    px = lambda pt: round(pt / 72 * 300)
    print("  推奨サイズ（印刷300dpi）")
    print("   ・配信の3枚（横向き） 各 %d x %d px 以上" % (px(sw), px(sh)))
    print("   ・YouTube連携（縦）      %d x %d px 以上" % (px(SW3), px(CH3 - 42)))
    print("  ※ 枠に合わせて自動で収まります（比率は保持・はみ出しません）")
