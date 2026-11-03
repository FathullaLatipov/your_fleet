"""Service-history exports: XLSX (openpyxl) and PDF (fpdf2).

Input rows are the dicts produced by fleet_ops._collect_service_records.
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO

COLUMNS = ["Date", "Unit", "Type", "Description", "Where", "Odometer (mi)", "Amount (USD)"]


def _flat(rec: dict) -> list:
    date = rec["date"][:10] if rec.get("date") else ""
    where = rec.get("shop_name") or ("Logged manually" if rec["kind"] == "logged" else "")
    kind = "Marketplace" if rec["kind"] == "marketplace" else (rec.get("category") or "logged").replace("_", " ")
    return [
        date,
        f"#{rec['unit_number']}" if rec.get("unit_number") else "",
        kind,
        rec.get("description") or "",
        where,
        round(rec["odometer_miles"]) if rec.get("odometer_miles") is not None else "",
        (rec["amount_cents"] or 0) / 100,
    ]


def records_to_xlsx(records: list[dict], period: str, unit: str | None = None) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Service records"

    ws.append(["YourFleet - Service records"])
    ws["A1"].font = Font(bold=True, size=14)
    scope = f"Truck #{unit}" if unit else "All trucks"
    ws.append([f"{scope} - period {period} - exported {datetime.now().date().isoformat()}"])
    ws.append([])

    ws.append(COLUMNS)
    header_row = ws.max_row
    for col in range(1, len(COLUMNS) + 1):
        c = ws.cell(row=header_row, column=col)
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="left")

    total = 0
    for rec in records:
        ws.append(_flat(rec))
        total += rec.get("amount_cents") or 0
        ws.cell(row=ws.max_row, column=7).number_format = "#,##0.00"

    ws.append([])
    ws.append(["", "", "", "", "", "Total", total / 100])
    last = ws.max_row
    ws.cell(row=last, column=6).font = Font(bold=True)
    ws.cell(row=last, column=7).font = Font(bold=True)
    ws.cell(row=last, column=7).number_format = "#,##0.00"

    widths = [12, 10, 14, 48, 26, 14, 14]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _latin(s: str) -> str:
    """fpdf core fonts are latin-1 only; degrade gracefully."""
    return (s or "").encode("latin-1", "replace").decode("latin-1")


def records_to_pdf(records: list[dict], period: str, unit: str | None = None) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    # Header band
    pdf.set_fill_color(22, 24, 27)          # charcoal
    pdf.rect(0, 0, 297, 18, style="F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", "B", 14)
    pdf.set_xy(10, 5)
    pdf.cell(0, 8, "YourFleet - Service records")
    pdf.set_font("helvetica", "", 9)
    scope = f"Truck #{unit}" if unit else "All trucks"
    pdf.set_xy(10, 20)
    pdf.set_text_color(76, 84, 94)
    pdf.cell(0, 6, _latin(f"{scope}  |  Period: {period}  |  Exported {datetime.now().date().isoformat()}"))
    pdf.ln(10)

    col_w = [22, 16, 26, 105, 48, 26, 24]
    pdf.set_x(10)
    pdf.set_font("helvetica", "B", 8.5)
    pdf.set_text_color(27, 30, 34)
    pdf.set_fill_color(241, 243, 242)       # mist
    for w, name in zip(col_w, COLUMNS):
        pdf.cell(w, 7, name, border="B", fill=True)
    pdf.ln()

    pdf.set_font("helvetica", "", 8.5)
    total = 0
    for i, rec in enumerate(records):
        row = _flat(rec)
        total += rec.get("amount_cents") or 0
        if pdf.get_y() > 185:
            pdf.add_page()
            pdf.set_x(10)
        pdf.set_x(10)
        pdf.set_fill_color(248, 249, 249)
        fill = i % 2 == 1
        values = [
            row[0], row[1], _latin(str(row[2])),
            _latin(str(row[3]))[:78], _latin(str(row[4]))[:34],
            f"{row[5]:,}" if row[5] != "" else "",
            f"${row[6]:,.2f}",
        ]
        for w, v in zip(col_w, values):
            pdf.cell(w, 6.5, str(v), border="B", fill=fill)
        pdf.ln()

    pdf.set_x(10)
    pdf.set_font("helvetica", "B", 9.5)
    pdf.cell(sum(col_w[:-1]), 8, f"Total - {len(records)} records", align="R")
    pdf.cell(col_w[-1], 8, f"${total / 100:,.2f}")

    return bytes(pdf.output())
