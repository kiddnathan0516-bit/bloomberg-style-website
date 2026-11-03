"""
Realistic multi-section demo documents (all FICTITIOUS people and data).

Each builder draws a full document with reportlab: page header with the issuer's name
(no logos), tables, charts and fine print, styled like real custodian / insurer / plan
paperwork. Every page carries a SAMPLE / fictitious notice.
"""

import math
import random

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas

GRAY = HexColor("#6B7280")
LIGHT = HexColor("#9CA3AF")
RULE = HexColor("#111827")
NOTICE_1 = "*** SAMPLE DOCUMENT ***"
NOTICE_2 = "Fictitious person and data - for software demo only"


def money(v, sign=False):
    s = f"${abs(v):,.2f}"
    if v < 0:
        return "-" + s
    return ("+" + s) if sign else s


class Doc:
    """Small helper around a reportlab canvas with the shared page frame."""

    def __init__(self, path, issuer, title, period, accent, pages, size=letter, footer=""):
        self.c = canvas.Canvas(path, pagesize=size)
        self.w, self.h = size
        self.issuer, self.title, self.period = issuer, title, period
        self.accent, self.pages, self.footer = HexColor(accent), pages, footer
        self.page = 0

    def new_page(self):
        if self.page:
            self.c.showPage()
        self.page += 1
        c, w, h = self.c, self.w, self.h
        c.setFillColor(LIGHT)
        c.setFont("Helvetica", 14)
        c.drawCentredString(w / 2, h - 34, NOTICE_1)
        c.setFont("Helvetica", 11)
        c.drawCentredString(w / 2, h - 50, NOTICE_2)
        c.setFillColor(self.accent)
        c.setFont("Helvetica-BoldOblique", 19 if len(self.issuer) <= 30 else 15)
        c.drawString(36, h - 78, self.issuer)
        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 9.5)
        c.drawRightString(w - 36, h - 70, self.title.upper())
        c.drawRightString(w - 36, h - 83, self.period)
        # footer band
        c.setStrokeColor(self.accent)
        c.setLineWidth(2)
        c.line(30, 62, w - 30, 62)
        c.setFillColor(HexColor("#EEF2EC") if self.accent.hexval() == "0x2f6b3a" else HexColor("#EEF1F6"))
        c.rect(30, 42, w - 60, 20, fill=1, stroke=0)
        c.setFillColor(GRAY)
        c.setFont("Helvetica-Oblique", 6.5)
        c.drawString(38, 49, self.footer[:190])
        c.setFont("Helvetica", 8)
        c.drawRightString(w - 36, 26, f"{self.page} of {self.pages}")
        c.setFillColor(black)

    def text(self, x, y, s, size=9, font="Helvetica", color=black, right=False, center=False):
        c = self.c
        c.setFont(font, size)
        c.setFillColor(color)
        if right:
            c.drawRightString(x, y, s)
        elif center:
            c.drawCentredString(x, y, s)
        else:
            c.drawString(x, y, s)
        c.setFillColor(black)

    def heading(self, x, y, s, size=13):
        self.text(x, y, s, size=size, font="Helvetica")

    def rule(self, x1, x2, y, width=0.8, color=RULE):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(width)
        self.c.line(x1, y, x2, y)

    def table(self, x, y, cols, rows, size=8.8, gap=14, header=True, bold_rows=(), total_rows=()):
        """cols: list of (label, width, align). rows: list of tuples. Returns next y."""
        if header:
            cx = x
            for label, width, align in cols:
                self.text(cx + (width if align == "r" else 0), y, label, size=7.6, font="Helvetica-Bold", right=align == "r")
                cx += width
            self.rule(x, x + sum(w for _, w, _ in cols), y - 4)
            y -= gap + 2
        for i, row in enumerate(rows):
            font = "Helvetica-Bold" if i in bold_rows or i in total_rows else "Helvetica"
            if i in total_rows:
                self.rule(x, x + sum(w for _, w, _ in cols), y + gap - 4, width=0.6)
            cx = x
            for (label, width, align), val in zip(cols, row):
                self.text(cx + (width if align == "r" else 0), y, str(val), size=size, font=font, right=align == "r")
                cx += width
            y -= gap
        return y

    SHADES = ["#1F2937", "#9CA3AF", "#4B5563", "#D1D5DB", "#6B7280", "#E5E7EB"]

    def pie(self, cx, cy, r, parts):
        """parts: list of (label, pct). Grayscale wedges; labels go in a legend (see legend())."""
        start = 90
        for i, (label, pct) in enumerate(parts):
            extent = -360 * pct / 100
            self.c.setFillColor(HexColor(self.SHADES[i % len(self.SHADES)]))
            self.c.setStrokeColor(white)
            self.c.setLineWidth(1.2)
            self.c.wedge(cx - r, cy - r, cx + r, cy + r, start, extent, fill=1, stroke=1)
            start += extent
        self.c.setFillColor(black)

    def legend(self, x, y, parts, width=170):
        self.text(x + 14, y, "Asset Class", size=7.6, font="Helvetica-Bold")
        self.text(x + width, y, "Percent", size=7.6, font="Helvetica-Bold", right=True)
        self.rule(x, x + width, y - 4)
        y -= 16
        for i, (label, pct) in enumerate(parts):
            self.c.setFillColor(HexColor(self.SHADES[i % len(self.SHADES)]))
            self.c.rect(x, y - 1, 8, 8, fill=1, stroke=0)
            self.text(x + 14, y, label, size=8.8)
            self.text(x + width, y, f"{pct}%", size=8.8, right=True)
            y -= 14
        return y

    def para(self, x, y, lines, size=8.6, gap=11.5, font="Helvetica", color=black):
        for ln in lines:
            self.text(x, y, ln, size=size, font=font, color=color)
            y -= gap
        return y

    def field(self, x, y, label, value, width=250):
        self.text(x, y + 11, label.upper(), size=6.8, font="Helvetica-Bold", color=GRAY)
        self.text(x, y, value, size=9.6)
        self.rule(x, x + width, y - 4, width=0.4, color=LIGHT)

    def checkbox(self, x, y, label, checked):
        self.c.setStrokeColor(black)
        self.c.setLineWidth(0.7)
        self.c.rect(x, y - 1, 8, 8, fill=0)
        if checked:
            self.text(x + 1.3, y, "X", size=8, font="Helvetica-Bold")
        self.text(x + 13, y, label, size=8.8)

    def save(self):
        self.c.showPage()
        self.c.save()


# ---------------------------------------------------------------------------
# 1. Brokerage statement (multi-page, like a custodian's quarterly report)
# ---------------------------------------------------------------------------
def brokerage_statement(path, owner, address_lines, custodian_long, acct_type, acct_number, period_label, period_end):
    rnd = random.Random(f"stmt-{owner}")
    d = Doc(path, custodian_long, "Investment Report", period_label, "#2F6B3A", 4, size=landscape(letter),
            footer=f"SAMPLE for a university software demo. Not issued by {custodian_long}. "
                   "Fictitious person, account and values; contains no real customer information.")
    W = d.w
    begin = round(rnd.uniform(380_000, 520_000), 2)
    deposits, withdrawals, fees = 12_500.00, -4_200.00, -186.40
    change = round(begin * rnd.uniform(0.018, 0.035), 2)
    end = round(begin + deposits + withdrawals + fees + change, 2)
    ytd_begin = round(begin * 0.94, 2)

    # page 1 - summary
    d.new_page()
    y = d.h - 150
    for ln in [owner, *address_lines]:
        d.text(90, y, ln, size=10)
        y -= 13
    d.text(W / 2 + 20, d.h - 140, "Your Portfolio Value:", size=13, font="Helvetica-Bold")
    d.text(W - 40, d.h - 140, money(end), size=21, font="Helvetica-Bold", right=True)
    d.text(W / 2 + 20, d.h - 162, "Change from Last Period:", size=9.5, font="Helvetica-Bold", color=GRAY)
    d.text(W - 40, d.h - 162, ("+ " if end >= begin else "- ") + money(abs(end - begin)), size=11, font="Helvetica-Bold", color=GRAY, right=True)
    cols = [("", 170, "l"), ("This Period", 95, "r"), ("Year-to-Date", 95, "r")]
    rows = [("Beginning Portfolio Value", money(begin), money(ytd_begin)),
            ("Additions", f"{deposits:,.2f}", f"{deposits * 2.4:,.2f}"),
            ("Subtractions", f"{withdrawals:,.2f}", f"{withdrawals * 3.1:,.2f}"),
            ("   Transaction Costs, Fees & Charges", f"{fees:,.2f}", f"{fees * 2.8:,.2f}"),
            ("Change in Investment Value *", f"{change:,.2f}", f"{(end - ytd_begin - deposits * 2.4 - withdrawals * 3.1 - fees * 2.8):,.2f}"),
            ("Ending Portfolio Value **", money(end), money(end))]
    y = d.table(W / 2 + 20, d.h - 200, cols, rows, bold_rows=(0,), total_rows=(5,))
    d.para(W / 2 + 20, y - 6, ["*  Appreciation or depreciation of your holdings due to price changes plus any distribution and",
                               "   income earned during the statement period.   ** Excludes unpriced securities."], size=7.2, gap=9, font="Helvetica-Oblique")
    d.heading(44, d.h - 330, "Contact Information")
    d.rule(44, 380, d.h - 335)
    d.table(44, d.h - 350, [("", 200, "l"), ("", 136, "r")],
            [("Online", "www.example-custody.com"), ("Automated Telephone", "(800) 555-0144"), ("Your Advisor", "Harbor Point Wealth Partners")], header=False)
    d.text(44, d.h - 440, "Welcome to your quarterly statement.", size=10, font="Helvetica-Bold")
    d.para(44, d.h - 455, ["Your account number can be found on page 2 in the Accounts Included in This Report",
                           "section. Please review your statement and contact your advisor with any questions."], size=9)

    # page 2 - accounts, income, allocation
    d.new_page()
    d.heading(44, d.h - 125, "Portfolio Summary")
    d.text(44, d.h - 150, "Accounts Included in This Report", size=11)
    y = d.table(44, d.h - 170, [("Account Type/Name", 300, "l"), ("Account Number", 150, "l"), ("Beginning Value", 130, "r"), ("Ending Value", 130, "r")],
                [(f"{owner} - {acct_type}", acct_number, money(begin), money(end)), ("Total Portfolio", "", money(begin), money(end))], total_rows=(1,))
    d.text(44, y - 20, "Income Summary", size=11)
    y = d.table(44, y - 40, [("", 170, "l"), ("This Period", 85, "r"), ("Year-to-Date", 85, "r")],
                [("Taxable", "$0.00", "$0.00"), ("Tax-deferred", money(1_842.17), money(5_906.44)), ("   Dividends", "1,402.55", "4,511.20"),
                 ("   Interest", "439.62", "1,395.24"), ("Total", money(1_842.17), money(5_906.44))], bold_rows=(1,), total_rows=(4,))
    alloc = [("Domestic Stock", 44), ("Bonds", 27), ("Foreign Stock", 18), ("Short-term", 7), ("Other", 4)]
    d.text(W / 2 + 20, d.h - 260, "Asset Allocation", size=11)
    d.pie(W / 2 + 95, d.h - 345, 62, alloc)
    d.legend(W - 220, d.h - 300, alloc)

    # page 3 - holdings
    d.new_page()
    d.heading(44, d.h - 125, "Holdings")
    d.text(W - 40, d.h - 125, f"Account {acct_number}  -  {owner}", size=9, font="Helvetica-Bold", right=True)
    holdings = [("Vanguard-style Total Stock Market ETF (VTX)", 0.21), ("S&P 500 Index Fund (SPX5)", 0.14), ("Total Bond Market Index (TBND)", 0.15),
                ("Intermediate Treasury Fund (ITRS)", 0.08), ("International Developed Equity (INTD)", 0.10), ("Emerging Markets Equity (EMKT)", 0.08),
                ("Apple Inc (AAPL)", 0.05), ("Microsoft Corp (MSFT)", 0.05), ("Corporate Bond Fund (CORP)", 0.04), ("Money Market Core Position (MMKT)", 0.07),
                ("Municipal Income Fund (MUNI)", 0.03)]
    rows = []
    for name, wt in holdings:
        value = end * wt
        price = rnd.uniform(18, 420) if "Money Market" not in name else 1.0
        rows.append((name, f"{value / price:,.3f}", f"{price:,.2f}", money(value), f"{wt * 100:.0f}%", f"{value * rnd.uniform(-0.04, 0.18):,.2f}"))
    rows.append(("Total Holdings", "", "", money(end), "100%", ""))
    d.table(44, d.h - 150, [("Description", 290, "l"), ("Quantity", 90, "r"), ("Price", 80, "r"), ("Market Value", 110, "r"),
                            ("% of Acct", 70, "r"), ("Unrealized G/L", 100, "r")], rows, total_rows=(len(rows) - 1,), gap=17)

    # page 4 - activity
    d.new_page()
    d.heading(44, d.h - 125, "Activity")
    m = period_end[5:7]
    acts = [(f"07/03", "Contribution", "Electronic funds transfer received", money(deposits)),
            (f"07/15", "Dividend", "Total Stock Market ETF", "612.40"), (f"08/01", "Buy", "Total Bond Market Index", "-8,000.00"),
            (f"08/15", "Dividend", "S&P 500 Index Fund", "455.10"), (f"08/30", "Advisory fee", "Harbor Point Wealth Partners", f"{fees:,.2f}"),
            (f"09/10", "Withdrawal", "Systematic distribution", f"{withdrawals:,.2f}"), (f"09/15", "Interest", "Money Market Core Position", "439.62"),
            (f"09/28", "Dividend", "International Developed Equity", "335.05")]
    d.table(44, d.h - 150, [("Settlement Date", 110, "l"), ("Transaction", 140, "l"), ("Description", 340, "l"), ("Amount", 120, "r")], acts, gap=18)
    d.para(44, 150, ["Important information: Please review this statement carefully and report any discrepancy promptly. This is a",
                     "fictitious sample created for a university software demonstration. It does not represent any real account."],
           size=7.6, gap=10, font="Helvetica-Oblique", color=GRAY)
    d.save()
    return end


# ---------------------------------------------------------------------------
# 2. Personal balance sheet (statement of financial condition)
# ---------------------------------------------------------------------------
def balance_sheet(path, names, as_of_label):
    d = Doc(path, "Smith Household", "Personal Financial Statement", f"As of {as_of_label}", "#1F3A5F", 2,
            footer="Prepared by the client for financial planning purposes. Values are client estimates and have not been audited.")
    d.new_page()
    d.text(36, d.h - 120, "Statement of Financial Condition", size=15, font="Helvetica-Bold")
    d.text(36, d.h - 137, f"Prepared for: {names}", size=10)
    d.text(36, d.h - 151, f"As of {as_of_label}", size=10, color=GRAY)
    assets = [("Cash & Cash Equivalents", ""), ("   Checking - Riverbank Credit Union", "18,420.55"), ("   High-yield savings", "42,000.00"),
              ("Investments", ""), ("   Schwab Individual Brokerage (...4417)", "671,230.00"), ("   Fidelity Individual Brokerage (...8803)", "214,880.12"),
              ("Retirement Accounts", ""), ("   Fidelity Rollover IRA (...2290)", "386,105.40"), ("   Schwab Roth IRA (...5126)", "97,430.88"),
              ("   Employer 401(k) - Linda", "152,600.00"), ("Real Estate & Personal Property", ""), ("   Primary residence (est.)", "715,000.00"),
              ("   Vehicles (2)", "41,500.00"), ("Total Assets", "2,339,166.95")]
    y = d.table(36, d.h - 185, [("ASSETS", 360, "l"), ("Amount ($)", 170, "r")], assets, bold_rows=(0, 3, 6, 10), total_rows=(13,), gap=15)
    liabs = [("Mortgage - primary residence", "312,480.00"), ("Auto loan", "14,250.00"), ("Credit cards (paid monthly)", "3,912.40"),
             ("Total Liabilities", "330,642.40")]
    y = d.table(36, y - 16, [("LIABILITIES", 360, "l"), ("Amount ($)", 170, "r")], liabs, total_rows=(3,), gap=15)
    d.rule(36, 566, y + 4, width=1.6)
    d.text(36, y - 12, "NET WORTH", size=12, font="Helvetica-Bold")
    d.text(566, y - 12, "$2,008,524.55", size=12, font="Helvetica-Bold", right=True)
    d.new_page()
    d.text(36, d.h - 120, "Notes and Certification", size=13, font="Helvetica-Bold")
    d.para(36, d.h - 145, ["1. Brokerage and retirement balances are taken from custodian statements dated September 30, 2026.",
                           "2. Residence value is the client's estimate based on recent neighborhood sales.",
                           "3. No contingent liabilities, personal guarantees or pending legal claims.",
                           "",
                           "I certify that the information above is true and complete to the best of my knowledge."], size=9.5, gap=14)
    d.field(36, d.h - 260, "Signature", "Linda M. Smith", 220)
    d.field(300, d.h - 260, "Date", "10/12/2026", 120)
    d.field(36, d.h - 305, "Signature", "John W. Smith", 220)
    d.field(300, d.h - 305, "Date", "10/12/2026", 120)
    d.save()


# ---------------------------------------------------------------------------
# 3. Household income statement
# ---------------------------------------------------------------------------
def income_statement(path, names, year):
    d = Doc(path, "Smith Household", "Statement of Income & Expenses", f"January 1 - December 31, {year}", "#1F3A5F", 1,
            footer="Prepared by the client from bank records and tax returns for financial planning purposes.")
    d.new_page()
    d.text(36, d.h - 120, "Household Income Statement", size=15, font="Helvetica-Bold")
    d.text(36, d.h - 137, f"Prepared for: {names}", size=10)
    d.text(36, d.h - 151, f"For the year ended December 31, {year}", size=10, color=GRAY)
    inc = [("Salary - Linda M. Smith", "148,000.00"), ("Consulting income - John W. Smith", "62,500.00"), ("Dividends & interest", "21,840.33"),
           ("Rental income (net)", "9,600.00"), ("Total Income", "241,940.33")]
    y = d.table(36, d.h - 185, [("INCOME", 380, "l"), ("Annual ($)", 150, "r")], inc, total_rows=(4,), gap=15)
    exp = [("Federal & state income taxes", "52,310.00"), ("Mortgage (principal & interest)", "28,944.00"), ("Property taxes & insurance", "11,420.00"),
           ("Living expenses (food, utilities, transportation)", "46,200.00"), ("Healthcare & insurance premiums", "9,880.00"),
           ("Travel & leisure", "14,500.00"), ("Charitable giving", "6,000.00"), ("Retirement contributions (401k / IRA)", "30,500.00"),
           ("Total Expenses & Savings", "199,754.00")]
    y = d.table(36, y - 16, [("EXPENSES & SAVINGS", 380, "l"), ("Annual ($)", 150, "r")], exp, total_rows=(8,), gap=15)
    d.rule(36, 566, y + 4, width=1.6)
    d.text(36, y - 12, "NET CASH FLOW (available for investment)", size=11.5, font="Helvetica-Bold")
    d.text(566, y - 12, "$42,186.33", size=11.5, font="Helvetica-Bold", right=True)
    d.para(36, y - 50, ["Savings rate including retirement contributions: 30.0% of gross income."], size=9, color=GRAY)
    d.save()


# ---------------------------------------------------------------------------
# 4. Life insurance annual policy report
# ---------------------------------------------------------------------------
def insurance_report(path, insured, owner_address, policy_no, report_date_label, beneficiary):
    d = Doc(path, "Northwind Life Insurance Company", "Annual Policy Report", f"Report date: {report_date_label}", "#7A1F3D", 2,
            footer="Northwind Life Insurance Company is a fictitious insurer created for a software demonstration. Not an offer of insurance.")
    d.new_page()
    d.text(36, d.h - 120, "Flexible Premium Universal Life - Annual Report", size=14, font="Helvetica-Bold")
    d.field(36, d.h - 160, "Insured", insured, 240)
    d.field(310, d.h - 160, "Policy number", policy_no, 240)
    d.field(36, d.h - 200, "Owner", insured, 240)
    d.field(310, d.h - 200, "Report period", "10/01/2025 - 09/30/2026", 240)
    d.field(36, d.h - 240, "Mailing address", owner_address, 514)
    d.text(36, d.h - 285, "Policy Values", size=12, font="Helvetica-Bold")
    rows = [("Specified amount (death benefit)", "$1,000,000.00"), ("Death benefit option", "Level (Option A)"), ("Accumulated value", "$84,316.52"),
            ("Surrender charge", "-$6,900.00"), ("Cash surrender value", "$77,416.52"), ("Policy loan balance", "$0.00"),
            ("Current credited interest rate", "4.10%"), ("Guaranteed minimum interest rate", "2.00%")]
    y = d.table(36, d.h - 305, [("", 380, "l"), ("", 160, "r")], rows, header=False, gap=15, bold_rows=(4,))
    d.text(36, y - 14, "Activity This Year", size=12, font="Helvetica-Bold")
    act = [("Beginning accumulated value", "$79,602.11"), ("Premiums paid", "$9,600.00"), ("Premium expense charges", "-$480.00"),
           ("Cost of insurance", "-$5,914.36"), ("Monthly administrative charges", "-$180.00"), ("Interest credited", "$1,688.77"),
           ("Ending accumulated value", "$84,316.52")]
    d.table(36, y - 34, [("", 380, "l"), ("", 160, "r")], act, header=False, gap=15, total_rows=(6,))
    d.new_page()
    d.text(36, d.h - 120, "Projected Values (current assumptions)", size=12, font="Helvetica-Bold")
    proj = []
    av = 84_316.52
    for yr in range(1, 11):
        av = av * 1.041 + 9_600 * 0.95 - 6_100 - yr * 60
        proj.append((str(2026 + yr), f"{55 + yr}", "$9,600", f"${av:,.0f}", f"${max(av - max(0, 6_900 - yr * 900), 0):,.0f}", "$1,000,000"))
    d.table(36, d.h - 145, [("Year", 60, "l"), ("Age", 60, "r"), ("Premium", 90, "r"), ("Accum. value", 110, "r"), ("Surrender value", 110, "r"),
                            ("Death benefit", 110, "r")], proj, gap=16)
    d.para(36, d.h - 360, ["Riders: Waiver of monthly deduction; Accelerated death benefit (chronic illness).",
                           f"Beneficiary on file: {beneficiary}. To change your beneficiary, contact your advisor.",
                           "Projected values are not guaranteed and depend on future interest rates and charges."], size=9, gap=13)
    d.save()


# ---------------------------------------------------------------------------
# 5. Certification of trust
# ---------------------------------------------------------------------------
def trust_certification(path, trust_name, trust_date, grantors, trustees, successor, signed_label):
    d = Doc(path, "Calder & Finch LLP", "Certification of Trust", f"Executed {signed_label}", "#3B3B3B", 2,
            footer="Calder & Finch LLP is a fictitious law firm created for a software demonstration. This is not a legal document.")
    d.new_page()
    d.text(d.w / 2, d.h - 125, "CERTIFICATION OF TRUST", size=16, font="Helvetica-Bold", center=True)
    d.text(d.w / 2, d.h - 142, "(Pursuant to the Uniform Trust Code, Section 1013)", size=9, color=GRAY, center=True)
    paras = [
        f"The undersigned Trustees certify the following facts regarding the {trust_name} (the \"Trust\"):",
        "",
        f"1.  The Trust exists and was executed on {trust_date}, and has not been revoked, modified or amended in",
        "     any manner that would cause the representations in this Certification to be incorrect.",
        f"2.  The Settlors (Grantors) of the Trust are: {grantors}.",
        f"3.  The currently acting Trustees are: {trustees}.",
        f"4.  The Successor Trustee is: {successor}.",
        "5.  The Trust is revocable by the Settlors during their lifetimes.",
        "6.  The Trustees have full power under the Trust to acquire, sell, hold and transfer securities, open and",
        "     maintain brokerage and advisory accounts, and to engage investment advisers.",
        "7.  Either Trustee acting alone may sign documents to exercise these powers.",
        "8.  The Trust's taxpayer identification number is the Social Security number of a Settlor (on file).",
        "9.  Title to Trust assets is to be taken as follows:",
        f"     {trustees}, Trustees of the {trust_name} dated {trust_date}.",
    ]
    y = d.para(48, d.h - 180, paras, size=9.8, gap=15)
    d.para(48, y - 10, ["The undersigned declare under penalty of perjury that the foregoing is true and correct."], size=9.8)
    d.new_page()
    d.text(36, d.h - 120, "Signatures of Trustees", size=13, font="Helvetica-Bold")
    names = [n.strip() for n in trustees.split(" and ")]
    yy = d.h - 175
    for n in names:
        d.field(36, yy, "Trustee signature", n, 260)
        d.field(330, yy, "Date", signed_label, 140)
        yy -= 55
    d.text(36, yy - 10, "Notary Acknowledgment", size=12, font="Helvetica-Bold")
    d.para(36, yy - 32, ["State of Maine, County of Cumberland. On the date above, the Trustees named herein personally appeared",
                         "before me and acknowledged that they executed this instrument. (Notary seal intentionally omitted - sample.)"], size=9, gap=13)
    d.field(36, yy - 95, "Notary public", "Jordan P. Ellis (fictitious)", 260)
    d.save()


# ---------------------------------------------------------------------------
# 6. Pension benefit statement
# ---------------------------------------------------------------------------
def pension_statement(path, participant, address, plan_name, as_of_label):
    d = Doc(path, plan_name, "Annual Pension Benefit Statement", f"As of {as_of_label}", "#0F4C81", 2,
            footer=f"{plan_name} is a fictitious defined benefit plan created for a software demonstration.")
    d.new_page()
    d.text(36, d.h - 120, "Your Pension Benefit Statement", size=15, font="Helvetica-Bold")
    d.field(36, d.h - 160, "Participant", participant, 240)
    d.field(310, d.h - 160, "Participant ID", "PEN-554210 (last 4: 4210)", 240)
    d.field(36, d.h - 200, "Address", address, 240)
    d.field(310, d.h - 200, "Date of birth", "On file", 240)
    d.text(36, d.h - 245, "Benefit Summary", size=12, font="Helvetica-Bold")
    rows = [("Date of hire", "06/01/1998"), ("Credited years of service", "28.3"), ("Vesting status", "100% vested"),
            ("Final average monthly pay (highest 5 years)", "$11,240.00"), ("Benefit formula", "1.5% x final avg pay x service"),
            ("Accrued monthly benefit at normal retirement (age 65)", "$4,771.38"), ("Normal retirement date", "04/01/2032"),
            ("Estimated lump-sum value today (for illustration)", "$712,940.00")]
    y = d.table(36, d.h - 265, [("", 380, "l"), ("", 160, "r")], rows, header=False, gap=15, bold_rows=(5,))
    d.text(36, y - 14, "Payment Options at Normal Retirement (estimated monthly)", size=12, font="Helvetica-Bold")
    opts = [("Single life annuity", "$4,771.38"), ("50% joint & survivor", "$4,390.67"), ("100% joint & survivor", "$4,055.67"),
            ("10-year certain and life", "$4,628.24")]
    d.table(36, y - 34, [("Option", 380, "l"), ("Monthly", 160, "r")], opts, gap=15)
    d.new_page()
    d.text(36, d.h - 120, "Beneficiary & Important Information", size=13, font="Helvetica-Bold")
    d.para(36, d.h - 145, ["Pre-retirement death beneficiary on file: Estate of participant.",
                           "Your benefit is protected by federal law (ERISA). Estimates assume you remain employed until normal retirement.",
                           "Contact the Plan Administrator at (800) 555-0199 with questions about this statement."], size=9.5, gap=14)
    d.save()


# ---------------------------------------------------------------------------
# 7. New client onboarding profile
# ---------------------------------------------------------------------------
def onboarding_profile(path, client, email, address, signed_label):
    d = Doc(path, "Harbor Point Wealth Partners", "New Client Profile", f"Signed {signed_label}", "#8A6D1D", 2,
            footer="Harbor Point Wealth Partners is a fictitious registered investment adviser created for a software demonstration.")
    d.new_page()
    d.text(36, d.h - 118, "Client Information", size=13, font="Helvetica-Bold")
    d.field(36, d.h - 155, "Full legal name", client, 250)
    d.field(310, d.h - 155, "Email", email, 250)
    d.field(36, d.h - 195, "Home address", address, 250)
    d.field(310, d.h - 195, "Phone", "(201) 555-0137", 250)
    d.field(36, d.h - 235, "Date of birth", "On file", 250)
    d.field(310, d.h - 235, "Tax ID", "On file (not shown)", 250)
    d.field(36, d.h - 275, "Employer / occupation", "Software engineer - Lumen Analytics", 250)
    d.field(310, d.h - 275, "Marital status", "Single", 250)
    d.text(36, d.h - 315, "Financial Profile", size=13, font="Helvetica-Bold")
    d.table(36, d.h - 335, [("", 280, "l"), ("", 120, "r")],
            [("Annual household income", "$175,000"), ("Liquid net worth", "$320,000"), ("Total net worth", "$410,000"),
             ("Annual expenses", "$92,000"), ("Emergency reserves (months)", "6")], header=False, gap=15)
    d.text(36, d.h - 430, "Goals (check all that apply)", size=13, font="Helvetica-Bold")
    goals = [("Retirement", True), ("Home purchase", True), ("Education", False), ("Tax efficiency", True), ("Charitable giving", False), ("Estate planning", False)]
    for i, (g, on) in enumerate(goals):
        d.checkbox(36 + (i % 3) * 180, d.h - 455 - (i // 3) * 18, g, on)
    d.new_page()
    d.text(36, d.h - 118, "Accounts to Transfer", size=13, font="Helvetica-Bold")
    d.table(36, d.h - 140, [("Current firm", 180, "l"), ("Account type", 160, "l"), ("Approx. value", 120, "r")],
            [("Robinhood-style app (fictitious)", "Individual brokerage", "$48,000"), ("Former employer 401(k)", "401(k)", "$96,500"),
             ("Online bank", "High-yield savings", "$60,000 (stays)")], gap=15)
    d.text(36, d.h - 225, "Acknowledgments", size=13, font="Helvetica-Bold")
    acks = ["I received Form ADV Part 2A and 2B and the firm's privacy notice.", "I understand the advisory fee schedule (0.85% on the first $1M).",
            "I agree to receive documents electronically.", "Trusted contact person: Priya Shah (sister), (201) 555-0190."]
    for i, a in enumerate(acks):
        d.checkbox(36, d.h - 250 - i * 18, a, True)
    d.field(36, d.h - 360, "Client signature", client, 250)
    d.field(330, d.h - 360, "Date", signed_label, 140)
    d.field(36, d.h - 405, "Advisor", "Harbor Point Wealth Partners", 250)
    d.save()
