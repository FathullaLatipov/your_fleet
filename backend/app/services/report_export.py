"""Generic report renderers: one report dict -> XLSX or PDF.

Report shape (built in api/fleet_reports.py):
  {title, subtitle, summary: [(label, value_str)],
   sections: [{heading, columns: [{h, t}], rows: [[...]], totals: [...]|None}]}
Column types: text | date (ISO str) | money (int cents) | int | dec1.
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO

NUM_TYPES = {"money", "int", "dec1"}


def _fmt(value, t: str) -> str:
    if value is None or value == "":
        return ""
    if t == "date":
        return str(value)[:10]
    if t == "money":
        return f"${value / 100:,.2f}"
    if t == "dec1":
        return f"{value:.1f}"
    if t == "int":
        return f"{round(value):,}"
    return str(value)


def report_to_xlsx(rep: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    used: set[str] = set()

    def sheet_name(raw: str) -> str:
        name = "".join(c for c in raw if c not in "[]:*?/\\")[:31] or "Report"
        base, n = name, 2
        while name in used:
            name = f"{base[:28]} {n}"
            n += 1
        used.add(name)
        return name

    for si, sec in enumerate(rep["sections"]):
        ws = wb.active if si == 0 else wb.create_sheet()
        ws.title = sheet_name(sec.get("heading") or rep["title"])
        if si == 0:
            ws.append([rep["title"]])
            ws["A1"].font = Font(bold=True, size=14)
            ws.append([rep["subtitle"]])
            ws.append([f"Exported {datetime.now().date().isoformat()} from YourFleet"])
            ws.append([])
            for label, value in rep.get("summary", []):
                ws.append([label, value])
                ws.cell(row=ws.max_row, column=2).font = Font(bold=True)
            ws.append([])
        elif sec.get("heading"):
            ws.append([sec["heading"]])
            ws["A1"].font = Font(bold=True, size=12)
            ws.append([])

        cols = sec["columns"]
        ws.append([c["h"] for c in cols])
        header_row = ws.max_row
        for ci in range(1, len(cols) + 1):
            cell = ws.cell(row=header_row, column=ci)
            cell.font = Font(bold=True)
            cell.alignment = Alignment(horizontal="left")

        def write_row(row, bold=False):
            out = []
            for v, c in zip(row, cols):
                if c["t"] == "money" and isinstance(v, (int, float)):
                    out.append(v / 100)
                else:
                    out.append(_fmt(v, c["t"]) if c["t"] in ("date",) else v)
            ws.append(out)
            for ci, c in enumerate(cols, start=1):
                cell = ws.cell(row=ws.max_row, column=ci)
                if c["t"] == "money":
                    cell.number_format = '"$"#,##0.00'
                elif c["t"] == "int":
                    cell.number_format = "#,##0"
                elif c["t"] == "dec1":
                    cell.number_format = "0.0"
                if bold:
                    cell.font = Font(bold=True)

        for row in sec["rows"]:
            write_row(row)
        if sec.get("totals"):
            write_row(sec["totals"], bold=True)

        # The summary block (label in A, value in B) shares the first two
        # columns with the table, so they must fit it too.
        summary = rep.get("summary", []) if si == 0 else []
        for ci, c in enumerate(cols, start=1):
            candidates = [len(c["h"]) + 2]
            candidates += [len(_fmt(r[ci - 1], c["t"])) + 2 for r in sec["rows"][:200]]
            if ci in (1, 2):
                candidates += [len(str(pair[ci - 1])) + 2 for pair in summary]
            ws.column_dimensions[get_column_letter(ci)].width = min(50, max(10, *candidates))

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _latin(s: str) -> str:
    return (s or "").encode("latin-1", "replace").decode("latin-1")


def report_to_pdf(rep: dict) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    pdf.set_fill_color(22, 24, 27)
    pdf.rect(0, 0, 297, 18, style="F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", "B", 14)
    pdf.set_xy(10, 5)
    pdf.cell(0, 8, _latin(f"YourFleet - {rep['title']}"))
    pdf.set_xy(10, 20)
    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(76, 84, 94)
    pdf.cell(0, 6, _latin(f"{rep['subtitle']}  |  Exported {datetime.now().date().isoformat()}"))
    pdf.ln(10)

    # Summary tiles
    if rep.get("summary"):
        pdf.set_x(10)
        per = min(4, len(rep["summary"]))
        w = (277 - 4 * (per - 1)) / per
        y0 = pdf.get_y()
        for i, (label, value) in enumerate(rep["summary"][:8]):
            col = i % per
            row = i // per
            x = 10 + col * (w + 4)
            y = y0 + row * 16
            pdf.set_fill_color(246, 247, 246)
            pdf.rect(x, y, w, 14, style="F")
            pdf.set_xy(x + 3, y + 2)
            pdf.set_font("helvetica", "", 7.5)
            pdf.set_text_color(76, 84, 94)
            pdf.cell(w - 6, 4, _latin(str(label)))
            pdf.set_xy(x + 3, y + 7)
            pdf.set_font("helvetica", "B", 10)
            pdf.set_text_color(27, 30, 34)
            pdf.cell(w - 6, 5, _latin(str(value)))
        rows_used = (min(8, len(rep["summary"])) + per - 1) // per
        pdf.set_y(y0 + rows_used * 16 + 4)

    for sec in rep["sections"]:
        cols = sec["columns"]
        weights = [c.get("w", 1.0) for c in cols]
        total_w = sum(weights)
        widths = [w / total_w * 277 for w in weights]

        if pdf.get_y() > 170:
            pdf.add_page()
        if sec.get("heading"):
            pdf.set_x(10)
            pdf.set_font("helvetica", "B", 11)
            pdf.set_text_color(27, 30, 34)
            pdf.cell(0, 7, _latin(sec["heading"]))
            pdf.ln(8)

        def header():
            pdf.set_x(10)
            pdf.set_font("helvetica", "B", 8)
            pdf.set_text_color(27, 30, 34)
            pdf.set_fill_color(241, 243, 242)
            for w, c in zip(widths, cols):
                pdf.cell(w, 6.5, _latin(c["h"]), border="B", fill=True,
                         align="R" if c["t"] in NUM_TYPES else "L")
            pdf.ln()

        header()
        pdf.set_font("helvetica", "", 8)
        for ri, row in enumerate(sec["rows"]):
            if pdf.get_y() > 188:
                pdf.add_page()
                header()
                pdf.set_font("helvetica", "", 8)
            pdf.set_x(10)
            pdf.set_fill_color(248, 249, 249)
            fill = ri % 2 == 1
            for w, v, c in zip(widths, row, cols):
                text = _latin(_fmt(v, c["t"]))
                max_chars = max(4, int(w / 1.65))
                pdf.cell(w, 6, text[:max_chars], border="B", fill=fill,
                         align="R" if c["t"] in NUM_TYPES else "L")
            pdf.ln()
        if sec.get("totals"):
            pdf.set_x(10)
            pdf.set_font("helvetica", "B", 8.5)
            for w, v, c in zip(widths, sec["totals"], cols):
                pdf.cell(w, 7, _latin(_fmt(v, c["t"])), border="T",
                         align="R" if c["t"] in NUM_TYPES else "L")
            pdf.ln(12)
        else:
            pdf.ln(8)

    return bytes(pdf.output())
