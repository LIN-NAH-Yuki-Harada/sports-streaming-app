#!/usr/bin/env python3
"""LIVE SPOtCH 開発費用見積もり（参考）Excel生成"""

import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook()
FN = "Meiryo UI"

f_title   = Font(name=FN, size=14, bold=True, color="1E1E2E")
f_section = Font(name=FN, size=11, bold=True, color="FFFFFF")
f_header  = Font(name=FN, size=10, bold=True, color="1E1E2E")
f_item    = Font(name=FN, size=10, color="333333")
f_item_b  = Font(name=FN, size=10, bold=True, color="333333")
f_total   = Font(name=FN, size=11, bold=True, color="1E1E2E")
f_grand   = Font(name=FN, size=12, bold=True, color="00B896")
f_sub     = Font(name=FN, size=9, color="888899")
f_note    = Font(name=FN, size=9, color="666666")

fill_sec    = PatternFill("solid", fgColor="2C3E50")
fill_hdr    = PatternFill("solid", fgColor="E8F5F1")
fill_light  = PatternFill("solid", fgColor="F8F9FB")
fill_white  = PatternFill("solid", fgColor="FFFFFF")
fill_total  = PatternFill("solid", fgColor="E6F9F5")
fill_grand  = PatternFill("solid", fgColor="D5F5ED")

align_c = Alignment(horizontal="center", vertical="center", wrap_text=True)
align_r = Alignment(horizontal="right", vertical="center")
align_l = Alignment(horizontal="left", vertical="center", indent=1)
align_l2 = Alignment(horizontal="left", vertical="center", indent=2)

thin = Side(style="thin", color="E2E8F0")
border_all = Border(top=thin, bottom=thin, left=thin, right=thin)
thick_bottom = Border(top=thin, bottom=Side(style="medium", color="1E1E2E"), left=thin, right=thin)

NUM = '#,##0'


# ══════════════════════════════════════
# Sheet 1: 見積もり明細（現在完成分 92%）
# ══════════════════════════════════════
ws = wb.active
ws.title = "見積もり明細（完成分92%）"
ws.sheet_properties.tabColor = "00B896"

ws.column_dimensions['A'].width = 8
ws.column_dimensions['B'].width = 42
ws.column_dimensions['C'].width = 14
ws.column_dimensions['D'].width = 16
ws.column_dimensions['E'].width = 16

# タイトル
ws.merge_cells('A1:E1')
ws['A1'].value = "LIVE SPOtCH 開発費用見積もり（参考） — 現在完成分（92%）"
ws['A1'].font = f_title
ws.row_dimensions[1].height = 30

ws.merge_cells('A2:E2')
ws['A2'].value = "一般的な開発会社に外注した場合の想定費用 ／ 単位: 円（税抜）"
ws['A2'].font = f_sub
ws.row_dimensions[2].height = 18
ws.row_dimensions[3].height = 6

# ヘッダー
row = 4
for ci, h in enumerate(["No.", "項目", "工数", "単価", "金額"], 1):
    c = ws.cell(row=row, column=ci, value=h)
    c.font = f_header; c.fill = fill_hdr; c.alignment = align_c; c.border = border_all
ws.row_dimensions[row].height = 26

# データ
estimate_data = [
    # (type, no, item, manmonth, unit_price, amount)
    ("section", "", "1. 要件定義・企画", "", "", ""),
    ("item", "1-1", "要件ヒアリング・整理", "PM 0.3人月", 1000000, 300000),
    ("item", "1-2", "機能仕様書作成", "PM 0.2人月", 1000000, 200000),
    ("subtotal", "", "小計", "0.5人月", "", 500000),

    ("section", "", "2. UI/UXデザイン", "", "", ""),
    ("item", "2-1", "ワイヤーフレーム設計（10画面）", "デザイナー 0.3人月", 700000, 210000),
    ("item", "2-2", "UIデザイン（10画面 + LP）", "デザイナー 0.5人月", 700000, 350000),
    ("item", "2-3", "レスポンシブ対応設計", "デザイナー 0.2人月", 700000, 140000),
    ("subtotal", "", "小計", "1.0人月", "", 700000),

    ("section", "", "3. フロントエンド開発", "", "", ""),
    ("item", "3-1", "Next.js環境構築・基盤設計", "FE 0.2人月", 800000, 160000),
    ("item", "3-2", "認証画面（Google OAuth）", "FE 0.2人月", 800000, 160000),
    ("item", "3-3", "ホーム画面（チーム一覧・配信中一覧）", "FE 0.2人月", 800000, 160000),
    ("item", "3-4", "配信画面（カメラ映像 + スコアオーバーレイ）", "FE 0.5人月", 800000, 400000),
    ("item", "3-5", "視聴画面（リアルタイムスコア更新）", "FE 0.3人月", 800000, 240000),
    ("item", "3-6", "スコアボードUI（スポーツ別ルール分岐）", "FE 0.3人月", 800000, 240000),
    ("item", "3-7", "マイページ（プロフィール編集・配信履歴）", "FE 0.2人月", 800000, 160000),
    ("item", "3-8", "LP（ランディングページ）", "FE 0.15人月", 800000, 120000),
    ("item", "3-9", "その他ページ（利用規約・PP・お問い合わせ等）", "FE 0.1人月", 800000, 80000),
    ("item", "3-10", "PWA対応（manifest・ServiceWorker）", "FE 0.15人月", 800000, 120000),
    ("item", "3-11", "ボトムナビ・共通レイアウト", "FE 0.15人月", 800000, 120000),
    ("subtotal", "", "小計", "2.5人月", "", 1960000),

    ("section", "", "4. バックエンド開発", "", "", ""),
    ("item", "4-1", "Supabase設計・DBスキーマ設計", "BE 0.2人月", 900000, 180000),
    ("item", "4-2", "認証基盤（Google OAuth + メール認証）", "BE 0.2人月", 900000, 180000),
    ("item", "4-3", "配信CRUD（broadcasts テーブル操作）", "BE 0.2人月", 900000, 180000),
    ("item", "4-4", "スコアリアルタイム更新（Realtime + ポーリング）", "BE 0.3人月", 900000, 270000),
    ("item", "4-5", "LiveKit連携（トークンAPI・映像配信制御）", "BE 0.4人月", 900000, 360000),
    ("item", "4-6", "セットスコア・ルール分岐ロジック", "BE 0.2人月", 900000, 180000),
    ("item", "4-7", "Stripe決済（Checkout・Webhook・顧客ポータル）", "BE 0.4人月", 900000, 360000),
    ("item", "4-8", "チーム管理（CRUD・招待コード・メンバー権限）", "BE 0.3人月", 900000, 270000),
    ("item", "4-9", "YouTube OAuth連携（認証・トークン管理）", "BE 0.3人月", 900000, 270000),
    ("item", "4-10", "パスワードリセット・お問い合わせAPI", "BE 0.15人月", 900000, 135000),
    ("item", "4-11", "プロフィール管理・退会API（Stripe解約連動）", "BE 0.15人月", 900000, 135000),
    ("item", "4-12", "LINE共有・共有コード生成", "BE 0.1人月", 900000, 90000),
    ("item", "4-13", "セキュリティ対策（RLS・トライアル検証・Cron）", "BE 0.2人月", 900000, 180000),
    ("subtotal", "", "小計", "3.2人月", "", 2790000),

    ("section", "", "5. インフラ構築・デプロイ", "", "", ""),
    ("item", "5-1", "Vercelデプロイ設定", "インフラ 0.1人月", 900000, 90000),
    ("item", "5-2", "Supabase本番環境構築", "インフラ 0.1人月", 900000, 90000),
    ("item", "5-3", "LiveKit Cloud設定・接続", "インフラ 0.1人月", 900000, 90000),
    ("item", "5-4", "環境変数管理・CI/CD", "インフラ 0.1人月", 900000, 90000),
    ("item", "5-5", "ドメイン・SSL・DNS設定", "インフラ 0.1人月", 900000, 90000),
    ("subtotal", "", "小計", "0.5人月", "", 450000),

    ("section", "", "6. テスト", "", "", ""),
    ("item", "6-1", "単体テスト・結合テスト", "QA 0.3人月", 550000, 165000),
    ("item", "6-2", "ブラウザ互換性テスト（iOS/Android/PC）", "QA 0.2人月", 550000, 110000),
    ("item", "6-3", "ライブ配信E2Eテスト", "QA 0.2人月", 550000, 110000),
    ("item", "6-4", "セキュリティテスト", "QA 0.15人月", 550000, 82500),
    ("item", "6-5", "パフォーマンステスト", "QA 0.15人月", 550000, 82500),
    ("subtotal", "", "小計", "1.0人月", "", 550000),

    ("section", "", "7. プロジェクト管理", "", "", ""),
    ("item", "7-1", "進捗管理・ミーティング", "PM 0.5人月", 1000000, 500000),
    ("item", "7-2", "仕様調整・変更管理", "PM 0.3人月", 1000000, 300000),
    ("item", "7-3", "納品・ドキュメント整備", "PM 0.2人月", 1000000, 200000),
    ("subtotal", "", "小計", "1.0人月", "", 1000000),
]

row = 5
for dtype, no, item, mm, unit, amount in estimate_data:
    ws.row_dimensions[row].height = 22

    if dtype == "section":
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=5)
        c = ws.cell(row=row, column=1, value=item)
        c.font = f_section; c.fill = fill_sec
        c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        for ci in range(1, 6):
            ws.cell(row=row, column=ci).fill = fill_sec
            ws.cell(row=row, column=ci).border = border_all
        row += 1; continue

    bg = fill_total if dtype == "subtotal" else (fill_light if row % 2 == 0 else fill_white)
    ft_item = f_item_b if dtype == "subtotal" else f_item

    for ci, (val, al) in enumerate([(no, align_c), (item, align_l2 if dtype != "subtotal" else align_l),
        (mm, align_c), (unit, align_r), (amount, align_r)], 1):
        c = ws.cell(row=row, column=ci, value=val)
        c.font = ft_item; c.fill = bg; c.alignment = al; c.border = border_all
        if ci >= 4 and isinstance(val, (int, float)) and val > 0:
            c.number_format = NUM

    row += 1

# 合計行
row += 1
ws.row_dimensions[row].height = 28
ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
c = ws.cell(row=row, column=1, value="開発費 合計（税抜）")
c.font = f_total; c.fill = fill_total; c.alignment = align_l; c.border = thick_bottom
for ci in range(2, 5):
    ws.cell(row=row, column=ci).fill = fill_total; ws.cell(row=row, column=ci).border = thick_bottom
c = ws.cell(row=row, column=5, value=7950000)
c.font = f_total; c.fill = fill_total; c.alignment = align_r; c.border = thick_bottom; c.number_format = NUM

row += 1
ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
ws.cell(row=row, column=1, value="消費税（10%）").font = f_item
ws.cell(row=row, column=1).alignment = align_l; ws.cell(row=row, column=1).border = border_all
for ci in range(2, 5):
    ws.cell(row=row, column=ci).border = border_all
c = ws.cell(row=row, column=5, value=795000)
c.font = f_item; c.alignment = align_r; c.border = border_all; c.number_format = NUM

row += 1
ws.row_dimensions[row].height = 30
ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
c = ws.cell(row=row, column=1, value="見積もり合計（税込）")
c.font = f_grand; c.fill = fill_grand; c.alignment = align_l; c.border = thick_bottom
for ci in range(2, 5):
    ws.cell(row=row, column=ci).fill = fill_grand; ws.cell(row=row, column=ci).border = thick_bottom
c = ws.cell(row=row, column=5, value=8745000)
c.font = f_grand; c.fill = fill_grand; c.alignment = align_r; c.border = thick_bottom; c.number_format = NUM


# ══════════════════════════════════════
# Sheet 2: 残り開発（25%）
# ══════════════════════════════════════
ws2 = wb.create_sheet("残り開発（8%）")
ws2.sheet_properties.tabColor = "F59E0B"

ws2.column_dimensions['A'].width = 8
ws2.column_dimensions['B'].width = 42
ws2.column_dimensions['C'].width = 14
ws2.column_dimensions['D'].width = 16

ws2.merge_cells('A1:D1')
ws2['A1'].value = "残り開発費用見積もり（ローンチまでの8%分）"
ws2['A1'].font = f_title; ws2.row_dimensions[1].height = 30

ws2.merge_cells('A2:D2')
ws2['A2'].value = "単位: 円（税抜）"; ws2['A2'].font = f_sub
ws2.row_dimensions[2].height = 18; ws2.row_dimensions[3].height = 6

for ci, h in enumerate(["No.", "項目", "工数", "金額"], 1):
    c = ws2.cell(row=4, column=ci, value=h)
    c.font = f_header; c.fill = fill_hdr; c.alignment = align_c; c.border = border_all

remaining = [
    ("1", "YouTube録画・自動アップロード（Phase 2-3）", "0.5人月", 450000),
    ("2", "UI最終調整・バグ修正", "0.2人月", 160000),
    ("3", "ベータテスト・品質保証", "0.3人月", 165000),
    ("4", "外部API利用料・インフラ増強", "—", 300000),
    ("5", "ローンチ後保守運用・追加開発", "—", 290000),
]

for i, (no, item, mm, amount) in enumerate(remaining):
    row = 5 + i
    bg = fill_light if row % 2 == 0 else fill_white
    for ci, (val, al) in enumerate([(no, align_c), (item, align_l2), (mm, align_c), (amount, align_r)], 1):
        c = ws2.cell(row=row, column=ci, value=val)
        c.font = f_item; c.fill = bg; c.alignment = al; c.border = border_all
        if ci == 4: c.number_format = NUM

row = 5 + len(remaining) + 1
ws2.row_dimensions[row].height = 26
ws2.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
ws2.cell(row=row, column=1, value="小計（税抜）").font = f_total
ws2.cell(row=row, column=1).fill = fill_total; ws2.cell(row=row, column=1).alignment = align_l; ws2.cell(row=row, column=1).border = border_all
for ci in range(2, 4): ws2.cell(row=row, column=ci).fill = fill_total; ws2.cell(row=row, column=ci).border = border_all
c = ws2.cell(row=row, column=4, value=1365000)
c.font = f_total; c.fill = fill_total; c.alignment = align_r; c.border = border_all; c.number_format = NUM

row += 1
ws2.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
ws2.cell(row=row, column=1, value="消費税（10%）").font = f_item; ws2.cell(row=row, column=1).alignment = align_l; ws2.cell(row=row, column=1).border = border_all
for ci in range(2, 4): ws2.cell(row=row, column=ci).border = border_all
c = ws2.cell(row=row, column=4, value=136500); c.font = f_item; c.alignment = align_r; c.border = border_all; c.number_format = NUM

row += 1
ws2.row_dimensions[row].height = 28
ws2.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
c = ws2.cell(row=row, column=1, value="合計（税込）")
c.font = f_grand; c.fill = fill_grand; c.alignment = align_l; c.border = thick_bottom
for ci in range(2, 4): ws2.cell(row=row, column=ci).fill = fill_grand; ws2.cell(row=row, column=ci).border = thick_bottom
c = ws2.cell(row=row, column=4, value=1501500)
c.font = f_grand; c.fill = fill_grand; c.alignment = align_r; c.border = thick_bottom; c.number_format = NUM


# ══════════════════════════════════════
# Sheet 3: 総合計サマリー
# ══════════════════════════════════════
ws3 = wb.create_sheet("総合計", 0)
ws3.sheet_properties.tabColor = "1E1E2E"

ws3.column_dimensions['A'].width = 35
ws3.column_dimensions['B'].width = 18
ws3.column_dimensions['C'].width = 18

ws3.merge_cells('A1:C1')
ws3['A1'].value = "LIVE SPOtCH 開発費用見積もり — 総合計"
ws3['A1'].font = f_title; ws3.row_dimensions[1].height = 30

ws3.merge_cells('A2:C2')
ws3['A2'].value = "一般的な開発会社に外注した場合の想定費用"; ws3['A2'].font = f_sub
ws3.row_dimensions[2].height = 18; ws3.row_dimensions[3].height = 6

for ci, h in enumerate(["項目", "税抜", "税込"], 1):
    c = ws3.cell(row=4, column=ci, value=h)
    c.font = f_header; c.fill = fill_hdr; c.alignment = align_c; c.border = border_all

summary = [
    ("現在完成分（92%）", 7950000, 8745000),
    ("残り開発分（8%）+ 保守・API費", 1365000, 1501500),
]
for i, (item, ex_tax, inc_tax) in enumerate(summary):
    row = 5 + i
    bg = fill_light if row % 2 == 0 else fill_white
    ws3.cell(row=row, column=1, value=item).font = f_item
    ws3.cell(row=row, column=1).fill = bg; ws3.cell(row=row, column=1).alignment = align_l; ws3.cell(row=row, column=1).border = border_all
    for ci, val in [(2, ex_tax), (3, inc_tax)]:
        c = ws3.cell(row=row, column=ci, value=val)
        c.font = f_item; c.fill = bg; c.alignment = align_r; c.border = border_all; c.number_format = NUM

row = 7
ws3.row_dimensions[row].height = 30
ws3.cell(row=row, column=1, value="全機能開発 総合計").font = f_grand
ws3.cell(row=row, column=1).fill = fill_grand; ws3.cell(row=row, column=1).alignment = align_l; ws3.cell(row=row, column=1).border = thick_bottom
for ci, val in [(2, 9315000), (3, 10246500)]:
    c = ws3.cell(row=row, column=ci, value=val)
    c.font = f_grand; c.fill = fill_grand; c.alignment = align_r; c.border = thick_bottom; c.number_format = NUM

# 補足
row = 9
ws3.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
ws3.cell(row=row, column=1, value="【補足】").font = Font(name=FN, size=10, bold=True, color="333333")

notes = [
    "上記は国内の中規模Web開発会社（従業員20〜50名程度）の標準的な見積もり水準です。",
    "大手SIer（NTTデータ、富士通等）の場合、1,500万〜2,000万円以上になることもあります。",
    "フリーランスへの発注の場合は、5割〜7割程度（約600万〜800万円）に抑えられる可能性があります。",
    "ライブ映像配信（LiveKit連携）は特殊技術のため、対応できる会社が限られ割増傾向です。",
    "保守・運用費（月額）は含まれていません。通常、開発費の15〜20%/年が保守費用の相場です。",
    "本見積もりは、AI開発ツールを活用せず従来の手法で開発した場合の想定です。",
]
for i, note in enumerate(notes):
    r = row + 1 + i
    ws3.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    ws3.cell(row=r, column=1, value=f"・{note}").font = f_note

# 人月単価シート
ws4 = wb.create_sheet("人月単価の前提")
ws4.sheet_properties.tabColor = "888899"
ws4.column_dimensions['A'].width = 30; ws4.column_dimensions['B'].width = 25

ws4.merge_cells('A1:B1')
ws4['A1'].value = "人月単価の前提（国内開発会社の相場）"; ws4['A1'].font = f_title
ws4.row_dimensions[1].height = 28

for ci, h in enumerate(["役割", "月額単価"], 1):
    c = ws4.cell(row=3, column=ci, value=h)
    c.font = f_header; c.fill = fill_hdr; c.alignment = align_c; c.border = border_all

rates = [
    ("プロジェクトマネージャー（PM）", "¥1,000,000〜1,200,000"),
    ("UIデザイナー", "¥600,000〜800,000"),
    ("フロントエンドエンジニア", "¥700,000〜900,000"),
    ("バックエンドエンジニア", "¥800,000〜1,000,000"),
    ("インフラエンジニア", "¥800,000〜1,000,000"),
    ("QAテスター", "¥500,000〜600,000"),
]
for i, (role, rate) in enumerate(rates):
    r = 4 + i
    bg = fill_light if r % 2 == 0 else fill_white
    ws4.cell(row=r, column=1, value=role).font = f_item
    ws4.cell(row=r, column=1).fill = bg; ws4.cell(row=r, column=1).alignment = align_l; ws4.cell(row=r, column=1).border = border_all
    ws4.cell(row=r, column=2, value=rate).font = f_item
    ws4.cell(row=r, column=2).fill = bg; ws4.cell(row=r, column=2).alignment = align_r; ws4.cell(row=r, column=2).border = border_all

ws4.cell(row=11, column=1, value="※ 中間値で算出。大手SIerの場合はこの1.5〜2倍になることもある。").font = f_note


out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "LIVE_SPOtCH_開発費用見積もり（参考）.xlsx")
wb.save(out)
print(f"保存完了: {out}")
