# LIVE SPOtCH 公式マニュアル A4 1枚 PDF v3.0
# LP（黒背景・赤アクセント）のトンマナに合わせる
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
JP = "HeiseiKakuGo-W5"

# カラーパレット（LPに合わせる）
BG     = HexColor("#0a0a0a")
CARD   = HexColor("#161616")
CARD2  = HexColor("#1f1414")
ACCENT = HexColor("#e63946")
WHITE  = HexColor("#ffffff")
GRAY1  = HexColor("#a8a8a8")
GRAY2  = HexColor("#6e6e6e")
GRAY3  = HexColor("#4a4a4a")
BORDER = HexColor("#2a2a2a")
GREEN  = HexColor("#22c55e")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "LIVE_SPOtCH_公式マニュアル.pdf")

W, H = A4
c = canvas.Canvas(OUT, pagesize=A4)


def draw_check(canvas_obj, x, y, color, size=5.5):
    """Draw a checkmark at (x, y) using path, since CID fonts miss ✓ glyph."""
    canvas_obj.saveState()
    canvas_obj.setStrokeColor(color)
    canvas_obj.setLineWidth(1.2)
    canvas_obj.setLineCap(1)
    canvas_obj.setLineJoin(1)
    p = canvas_obj.beginPath()
    p.moveTo(x, y + size * 0.35)
    p.lineTo(x + size * 0.40, y)
    p.lineTo(x + size, y + size * 0.75)
    canvas_obj.drawPath(p, stroke=1, fill=0)
    canvas_obj.restoreState()

# 背景
c.setFillColor(BG)
c.rect(0, 0, W, H, stroke=0, fill=1)

# ────────────────── ヘッダー ──────────────────
y = H - 50

c.setFillColor(ACCENT)
c.roundRect(40, y - 8, 38, 16, 2, stroke=0, fill=1)
c.setFillColor(WHITE)
c.setFont("Helvetica-Bold", 9)
c.drawCentredString(59, y - 4, "LIVE")

c.setFillColor(WHITE)
c.setFont("Helvetica-Bold", 16)
c.drawString(86, y - 4, "LIVE SPOtCH")

c.setFillColor(GRAY2)
c.setFont(JP, 9)
c.drawRightString(W - 40, y - 4, "公式マニュアル v3.0")

c.setStrokeColor(BORDER)
c.setLineWidth(0.5)
c.line(40, y - 18, W - 40, y - 18)

# ────────────────── ヒーロー ──────────────────
y = H - 95
c.setFillColor(ACCENT)
c.setFont(JP, 8)
c.drawString(40, y, "誰もがスポーツ中継のカメラマン。手元のスマホが機材になる。")

c.setFillColor(WHITE)
c.setFont(JP, 21)
c.drawString(40, y - 26, "子どもの試合を、")
c.drawString(40, y - 50, "どこにいても見届ける。")

c.setFillColor(GRAY1)
c.setFont(JP, 9)
c.drawString(40, y - 72, "スポーツ少年団の大会、部活の公式戦、地域リーグ。")
c.drawString(40, y - 86, "共有コードひとつで、チームの関係者だけがリアルタイム観戦できます。")

# 右上の無料カード
c.setFillColor(HexColor("#1a0608"))
c.roundRect(W - 200, y - 85, 160, 75, 6, stroke=0, fill=1)
c.setStrokeColor(ACCENT)
c.setLineWidth(0.5)
c.roundRect(W - 200, y - 85, 160, 75, 6, stroke=1, fill=0)
c.setFillColor(ACCENT)
c.setFont(JP, 7)
c.drawString(W - 188, y - 20, "まずは試してみる")
c.setFillColor(WHITE)
c.setFont(JP, 13)
c.drawString(W - 188, y - 40, "初回10分間 無料")
c.setFillColor(GRAY2)
c.setFont(JP, 7)
c.drawString(W - 188, y - 56, "クレジットカード登録不要")
c.drawString(W - 188, y - 68, "メールまたはGoogleで会員登録")

# ────────────────── 配信する方へ ──────────────────
y = H - 225
c.setFillColor(WHITE)
c.setFont(JP, 12)
c.drawString(40, y, "配信する方へ")
_w = c.stringWidth("配信する方へ", JP, 12)
c.setFillColor(GRAY2)
c.setFont(JP, 8)
c.drawString(40 + _w + 10, y, "for Streamers / 保護者・コーチ向け")

steps = [
    ("STEP 1", "会員登録", "Google または メール/パスワード\nで30秒で登録。チーム名を入力\nすれば初回10分間は無料。"),
    ("STEP 2", "配信開始", "種目・チーム名・対戦相手を入力。\n「配信をスタート」で共有コード\nが自動発行。LINEで送るだけ。"),
    ("STEP 3", "スコア操作", "配信画面のボタンでスコア更新。\nTV中継風オーバーレイで\n視聴者にリアルタイム表示。"),
    ("STEP 4", "チーム運用", "チームプラン(¥500/月)なら\nメンバー招待とスケジュール管理を\nダッシュボードで一元運用。"),
]
step_w = (W - 80 - 18) / 4
step_h = 88
sy = y - step_h - 10
for i, (step, title, desc) in enumerate(steps):
    x = 40 + i * (step_w + 6)
    c.setFillColor(CARD)
    c.roundRect(x, sy, step_w, step_h, 5, stroke=0, fill=1)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.4)
    c.roundRect(x, sy, step_w, step_h, 5, stroke=1, fill=0)
    c.setFillColor(ACCENT)
    c.roundRect(x, sy + step_h - 2, step_w, 2, 0, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 10, sy + step_h - 16, step)
    c.setFillColor(WHITE)
    c.setFont(JP, 10)
    c.drawString(x + 10, sy + step_h - 34, title)
    c.setFillColor(GRAY1)
    c.setFont(JP, 7.5)
    for j, line in enumerate(desc.split("\n")):
        c.drawString(x + 10, sy + step_h - 50 - j * 11, line)

# ────────────────── 観戦する方へ ──────────────────
y = sy - 25
c.setFillColor(WHITE)
c.setFont(JP, 12)
c.drawString(40, y, "観戦する方へ")
_w = c.stringWidth("観戦する方へ", JP, 12)
c.setFillColor(GRAY2)
c.setFont(JP, 8)
c.drawString(40 + _w + 10, y, "for Viewers / ご家族・OB/OG向け  ※視聴は完全無料")

vsteps = [
    ("STEP 1", "共有コードを受け取る", "LINEで届いたURLをタップ、\nまたはホーム画面で6桁コードを入力。"),
    ("STEP 2", "すぐに観戦スタート", "Google またはメールでログイン。\n超低遅延0.25秒でリアルタイム視聴。"),
]
v_step_w = (W - 80 - 8) / 2
v_step_h = 60
vy = y - v_step_h - 10
for i, (step, title, desc) in enumerate(vsteps):
    x = 40 + i * (v_step_w + 8)
    c.setFillColor(CARD)
    c.roundRect(x, vy, v_step_w, v_step_h, 5, stroke=0, fill=1)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.4)
    c.roundRect(x, vy, v_step_w, v_step_h, 5, stroke=1, fill=0)
    c.setFillColor(ACCENT)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 12, vy + v_step_h - 16, step)
    c.setFillColor(WHITE)
    c.setFont(JP, 10)
    c.drawString(x + 12, vy + v_step_h - 34, title)
    c.setFillColor(GRAY1)
    c.setFont(JP, 7.5)
    for j, line in enumerate(desc.split("\n")):
        c.drawString(x + 12, vy + v_step_h - 48 - j * 11, line)

# ────────────────── 料金プラン ──────────────────
y = vy - 25
c.setFillColor(WHITE)
c.setFont(JP, 12)
c.drawString(40, y, "料金プラン")
_w = c.stringWidth("料金プラン", JP, 12)
c.setFillColor(GRAY2)
c.setFont(JP, 8)
c.drawString(40 + _w + 10, y, "Pricing")

plans = [
    ("視聴する人", "無料", "", ["共有コードでライブ視聴", "1ヶ月以内のアーカイブ視聴", "アプリ不要・ブラウザで視聴", "全端末対応（PC/スマホ）"], False),
    ("配信者プラン", "¥300", "/月", ["ライブ配信 + スコアオーバーレイ", "LINE共有（ワンタップ）", "アーカイブ自動保存", "初回10分間無料お試し"], True),
    ("チームプラン", "¥500", "/月", ["配信者プランの全機能", "チーム管理・メンバー招待", "スケジュール管理・試合予定", "ダッシュボードで一元運用"], False),
]
p_w = (W - 80 - 16) / 3
p_h = 116
py = y - p_h - 10
for i, (name, price, unit, feats, hl) in enumerate(plans):
    x = 40 + i * (p_w + 8)
    if hl:
        c.setFillColor(HexColor("#1a0608"))
        c.setStrokeColor(ACCENT)
    else:
        c.setFillColor(CARD)
        c.setStrokeColor(BORDER)
    c.roundRect(x, py, p_w, p_h, 5, stroke=0, fill=1)
    c.setLineWidth(0.5 if hl else 0.4)
    c.roundRect(x, py, p_w, p_h, 5, stroke=1, fill=0)
    c.setFillColor(ACCENT if hl else GRAY1)
    c.setFont(JP, 8)
    c.drawString(x + 12, py + p_h - 16, name)
    c.setFillColor(WHITE)
    # 日本語が含まれる場合（例: 無料）は JP フォント、それ以外は Helvetica-Bold
    is_ascii_price = all(ord(ch) < 128 for ch in price)
    if is_ascii_price:
        c.setFont("Helvetica-Bold", 20)
        price_font, price_size = "Helvetica-Bold", 20
    else:
        c.setFont(JP, 18)
        price_font, price_size = JP, 18
    c.drawString(x + 12, py + p_h - 40, price)
    if unit:
        pw = c.stringWidth(price, price_font, price_size)
        c.setFillColor(GRAY1)
        c.setFont(JP, 9)
        c.drawString(x + 12 + pw + 2, py + p_h - 40, unit)
    c.setFont(JP, 7.5)
    for j, f in enumerate(feats):
        row_y = py + p_h - 58 - j * 13
        draw_check(c, x + 12, row_y + 1, ACCENT if hl else GREEN)
        c.setFillColor(GRAY1)
        c.drawString(x + 22, row_y, f)

# ────────────────── 安心して使える理由 + 便利な機能 ──────────────────
y = py - 25
c.setFillColor(WHITE)
c.setFont(JP, 12)
title = "安心して使える理由 & 便利な機能"
c.drawString(40, y, title)
_w = c.stringWidth(title, JP, 12)
c.setFillColor(GRAY2)
c.setFont(JP, 8)
c.drawString(40 + _w + 10, y, "Features")

trust = [
    ("限定公開", "共有コードを持つ人だけ。\n不特定多数には公開されません。"),
    ("超低遅延 0.25秒", "テレビ放送より速い。\nゴールの瞬間を、ほぼ同時に。"),
    ("TV中継品質", "スコアボードを常時表示。\n試合状況がひと目でわかる。"),
    ("Webだけで完結", "アプリDL不要。LINEで送るだけ。\nどんな端末でも視聴できます。"),
    ("スケジュール", "試合予定を登録してチームで共有。\n配信日もワンタップで。"),
    ("安心のセキュリティ", "Stripe決済・2FA対応。\n子どもの映像を守る限定配信。"),
]
t_w = (W - 80 - 30) / 6
t_h = 50
ty = y - t_h - 10
for i, (title, desc) in enumerate(trust):
    x = 40 + i * (t_w + 6)
    c.setFillColor(CARD)
    c.roundRect(x, ty, t_w, t_h, 4, stroke=0, fill=1)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.4)
    c.roundRect(x, ty, t_w, t_h, 4, stroke=1, fill=0)
    c.setFillColor(ACCENT)
    c.setFont(JP, 8)
    c.drawString(x + 8, ty + t_h - 14, title)
    c.setFillColor(GRAY1)
    c.setFont(JP, 6.5)
    for j, line in enumerate(desc.split("\n")):
        c.drawString(x + 8, ty + t_h - 27 - j * 9, line)

# 推奨環境
ey = ty - 16
c.setFillColor(GRAY2)
c.setFont(JP, 7)
c.drawString(40, ey, "推奨環境: iOS 15+ / Android 10+ / Chrome・Safari 最新版 / Wi-Fi または 4G/5G 回線推奨")

# ────────────────── フッター ──────────────────
fy = 48
c.setStrokeColor(BORDER)
c.setLineWidth(0.5)
c.line(40, fy + 26, W - 40, fy + 26)

c.setFillColor(GRAY2)
c.setFont(JP, 7)
c.drawString(40, fy + 14, "お問い合わせ")
c.setFillColor(WHITE)
c.setFont(JP, 8)
c.drawString(40, fy + 2, "アプリ内「お問い合わせ」フォーム")
c.setFillColor(GRAY2)
c.setFont(JP, 7)
c.drawString(40, fy - 10, "運営: LIN-NAH株式会社")

c.setFillColor(GRAY2)
c.setFont(JP, 7)
c.drawString(W / 2 - 60, fy + 14, "公式サイト")
c.setFillColor(WHITE)
c.setFont("Helvetica", 8)
c.drawString(W / 2 - 60, fy + 2, "sports-streaming-app.vercel.app")
c.setFillColor(GRAY2)
c.setFont(JP, 7)
c.drawString(W / 2 - 60, fy - 10, "ブラウザでアクセス → ホーム画面に追加可")

c.setFillColor(GRAY3)
c.setFont(JP, 7)
c.drawRightString(W - 40, fy + 2, "© 2026 LIVE SPOtCH / LIN-NAH株式会社")
c.drawRightString(W - 40, fy - 10, "その一瞬の感動を手のひらに。")

# 最下部の赤ライン
c.setFillColor(ACCENT)
c.rect(0, 0, W, 3, stroke=0, fill=1)

c.save()
print(f"保存完了: {OUT}")
