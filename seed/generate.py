"""
Seed data generator for RIA Doc Inbox.

Creates FAKE demo data only:
  seed/data/households.json   - client directory (8 households, 16 people)
  seed/data/emails.json       - ~25 simulated emails (incl. distractors)
  seed/data/answer-key.json   - the correct answer for every email and document
  seed/data/pdfs/*.pdf        - the attachments (text PDFs + a few "scanned" image-only PDFs)

Run once with:  python3 seed/generate.py
The output is committed to the repo, so you never need to run this again
unless you want to change the demo data.
"""

import json
import os
import random
from datetime import datetime

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

import realistic

random.seed(42)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data")
PDF_DIR = os.path.join(OUT, "pdfs")
os.makedirs(PDF_DIR, exist_ok=True)

FIRM = "Harbor Point Wealth Partners"  # fictional RIA
FAKE_NOTICE = "SAMPLE DOCUMENT - FICTITIOUS PERSON AND DATA - FOR SOFTWARE DEMO ONLY"

# ---------------------------------------------------------------------------
# 1. Client directory (all names, emails, addresses and accounts are made up)
# ---------------------------------------------------------------------------
HOUSEHOLDS = [
    {"id": "HH-SMITH", "name": "Smith Household", "status": "existing", "address": "14 Elm Row, Hartford, CT 06103", "members": [
        {"id": "P-JSMITH", "first": "John", "last": "Smith", "email": "john.smith@example.com", "role": "primary",
         "accounts": [{"custodian": "Schwab", "type": "Individual Brokerage", "last4": "4417"},
                      {"custodian": "Fidelity", "type": "Rollover IRA", "last4": "2290"}]},
        {"id": "P-LSMITH", "first": "Linda", "last": "Smith", "email": "linda.smith@example.com", "role": "spouse",
         "accounts": [{"custodian": "Fidelity", "type": "Individual Brokerage", "last4": "8803"},
                      {"custodian": "Schwab", "type": "Roth IRA", "last4": "5126"}]},
    ]},
    {"id": "HH-CHEN", "name": "Chen Household", "status": "existing", "address": "220 Bayview Ave, Providence, RI 02903", "members": [
        {"id": "P-DCHEN", "first": "David", "last": "Chen", "email": "david.chen@example.com", "role": "primary",
         "accounts": [{"custodian": "Schwab", "type": "Individual Brokerage", "last4": "6034"},
                      {"custodian": "Vanguard", "type": "Traditional IRA", "last4": "1178"}]},
        {"id": "P-MCHEN", "first": "Mary", "last": "Chen", "email": "mary.chen@example.com", "role": "spouse",
         "accounts": [{"custodian": "Schwab", "type": "Roth IRA", "last4": "3391"}]},
    ]},
    {"id": "HH-PATEL-R", "name": "Raj & Priya Patel Household", "status": "new", "address": "9 Orchard Ln, Edison, NJ 08817", "members": [
        {"id": "P-RPATEL", "first": "Raj", "last": "Patel", "email": "raj.patel@example.com", "role": "primary",
         "accounts": [{"custodian": "Schwab", "type": "Joint Brokerage", "last4": "7702"}]},
        {"id": "P-PPATEL", "first": "Priya", "last": "Patel", "email": "priya.patel@example.com", "role": "spouse",
         "accounts": [{"custodian": "Schwab", "type": "Individual Brokerage", "last4": "9415"}]},
    ]},
    {"id": "HH-PATEL-A", "name": "Anil Patel Household", "status": "new", "address": "301 Grove St, Jersey City, NJ 07302", "members": [
        {"id": "P-APATEL", "first": "Anil", "last": "Patel", "email": "anil.patel@example.net", "role": "primary",
         "accounts": [{"custodian": "Schwab", "type": "Individual Brokerage", "last4": "2048"}]},
    ]},
    {"id": "HH-RODRIGUEZ", "name": "Rodriguez Household", "status": "existing", "address": "77 Mission Rd, Worcester, MA 01602", "members": [
        {"id": "P-CRODRIGUEZ", "first": "Carlos", "last": "Rodriguez", "email": "carlos.rodriguez@example.com", "role": "primary",
         "accounts": [{"custodian": "Fidelity", "type": "Individual Brokerage", "last4": "5561"}]},
        {"id": "P-ERODRIGUEZ", "first": "Elena", "last": "Rodriguez", "email": "elena.rodriguez@example.com", "role": "spouse",
         "accounts": [{"custodian": "Fidelity", "type": "Traditional IRA", "last4": "6620"}]},
        {"id": "P-SRODRIGUEZ", "first": "Sofia", "last": "Rodriguez", "email": "sofia.rodriguez@example.org", "role": "adult child",
         "accounts": [{"custodian": "Schwab", "type": "Roth IRA", "last4": "0937"}]},
    ]},
    {"id": "HH-JOHNSON", "name": "Johnson Household", "status": "existing", "address": "5 Quarry Hill, Burlington, VT 05401", "members": [
        {"id": "P-MJOHNSON", "first": "Mark", "last": "Johnson", "email": "mark.johnson@example.com", "role": "primary",
         "accounts": [{"custodian": "Fidelity", "type": "Individual Brokerage", "last4": "7731"}]},
    ]},
    {"id": "HH-OBRIEN", "name": "O'Brien Household", "status": "existing", "address": "18 Harbor St, Portland, ME 04101", "members": [
        {"id": "P-KOBRIEN", "first": "Kathleen", "last": "O'Brien", "email": "kathleen.obrien@example.com", "role": "primary",
         "accounts": [{"custodian": "Vanguard", "type": "Individual Brokerage", "last4": "4482"}]},
        {"id": "P-SOBRIEN", "first": "Sean", "last": "O'Brien", "email": "sean.obrien@example.com", "role": "spouse",
         "accounts": [{"custodian": "Schwab", "type": "Rollover IRA", "last4": "1609"}]},
    ]},
    {"id": "HH-NGUYEN", "name": "Nguyen Household", "status": "existing", "address": "402 Lake Shore Dr, Nashua, NH 03060", "members": [
        {"id": "P-TNGUYEN", "first": "Thomas", "last": "Nguyen", "email": "thomas.nguyen@example.com", "role": "primary",
         "accounts": [{"custodian": "Schwab", "type": "Individual Brokerage", "last4": "8157"}]},
        {"id": "P-ANGUYEN", "first": "Anna", "last": "Nguyen", "email": "anna.nguyen@example.com", "role": "spouse",
         "accounts": [{"custodian": "Schwab", "type": "Roth IRA", "last4": "2764"}]},
        {"id": "P-LNGUYEN", "first": "Le", "last": "Nguyen", "email": "", "role": "parent (new client)",
         "accounts": [{"custodian": "Schwab", "type": "Individual Brokerage", "last4": "3350"}]},
    ]},
]

PEOPLE = {m["id"]: {**m, "household_id": h["id"], "address": h["address"]} for h in HOUSEHOLDS for m in h["members"]}


def full_acct(last4):
    """A fake full account number ending in last4 (tests the last-4-only rule)."""
    return f"{random.randint(1000, 9999)}-{random.randint(1000, 9999)}-{last4}"


def name(pid):
    p = PEOPLE[pid]
    return f"{p['first']} {p['last']}"


# ---------------------------------------------------------------------------
# 2. PDF builders
# ---------------------------------------------------------------------------
CUSTODIAN_LONG = {
    "Schwab": "Charles Schwab & Co., Inc.",
    "Fidelity": "Fidelity Brokerage Services LLC",
    "Vanguard": "Vanguard Brokerage Services",
    "NorthwindLife": "Northwind Life Insurance Company",
    "HarborPoint": FIRM,
}


def header(c, title, issuer):
    w, h = letter
    c.setFillColorRGB(0.07, 0.2, 0.36)
    c.rect(0, h - 70, w, 70, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, h - 40, issuer)
    c.setFont("Helvetica", 11)
    c.drawRightString(w - 40, h - 40, title)
    c.setFillColorRGB(0, 0, 0)


def footer(c):
    w, _ = letter
    c.setFont("Helvetica-Oblique", 7)
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawCentredString(w / 2, 25, FAKE_NOTICE)
    c.setFillColorRGB(0, 0, 0)


def lines(c, x, y, rows, size=10, gap=15, font="Helvetica"):
    c.setFont(font, size)
    for r in rows:
        c.drawString(x, y, r)
        y -= gap
    return y


def statement_pdf(path, owner_lines, custodian, acct_type, acct, period_label, period_end, balance, show_name=True):
    c = canvas.Canvas(path, pagesize=letter)
    _, h = letter
    header(c, "Account Statement", CUSTODIAN_LONG[custodian])
    y = h - 110
    if show_name:
        y = lines(c, 40, y, owner_lines)
    else:
        y = lines(c, 40, y, ["Account holder information on file", "Paperless delivery"])
    y -= 10
    y = lines(c, 40, y, [
        f"Statement Period: {period_label}",
        f"Account Type: {acct_type}",
        f"Account Number: {acct}",
    ], font="Helvetica-Bold")
    y -= 15
    begin = round(balance * random.uniform(0.93, 0.99), 2)
    y = lines(c, 40, y, [
        "ACCOUNT SUMMARY",
        f"Beginning Value          ${begin:,.2f}",
        f"Deposits                 ${random.randint(0, 5000):,.2f}",
        f"Change in Market Value   ${balance - begin:,.2f}",
        f"Ending Value ({period_end})   ${balance:,.2f}",
    ])
    y -= 15
    holdings = [("US Total Market Index Fund", 0.42), ("Intl Developed Markets Fund", 0.18),
                ("Short-Term Treasury ETF", 0.25), ("Cash & Money Market", 0.15)]
    rows = ["HOLDINGS                              % of acct      Market Value"]
    for hname, pct in holdings:
        rows.append(f"{hname:<38}{pct * 100:>5.1f}%      ${balance * pct:,.2f}")
    lines(c, 40, y, rows, font="Courier", size=9)
    footer(c)
    c.showPage()
    c.save()


def tax1099_pdf(path, owner_lines, custodian, acct, tax_year):
    c = canvas.Canvas(path, pagesize=letter)
    _, h = letter
    header(c, f"{tax_year} Form 1099 Composite", CUSTODIAN_LONG[custodian])
    y = lines(c, 40, h - 110, owner_lines)
    y -= 10
    y = lines(c, 40, y, [f"Tax Year {tax_year}", f"Account Number: {acct}",
                         f"Date prepared: February 14, {tax_year + 1}"], font="Helvetica-Bold")
    y -= 15
    lines(c, 40, y, [
        "FORM 1099-DIV  Dividends and Distributions",
        f"  1a Total ordinary dividends      ${random.randint(800, 9000):,.2f}",
        f"  1b Qualified dividends           ${random.randint(500, 6000):,.2f}",
        "FORM 1099-INT  Interest Income",
        f"  1  Interest income               ${random.randint(50, 2500):,.2f}",
        "FORM 1099-B  Proceeds from Broker Transactions",
        f"  Total proceeds                   ${random.randint(5000, 90000):,.2f}",
        "This is important tax information and is being furnished to the IRS.",
    ])
    footer(c)
    c.showPage()
    c.save()


def form_pdf(path, title, issuer, intro, fields, signed_date):
    c = canvas.Canvas(path, pagesize=letter)
    _, h = letter
    header(c, title, CUSTODIAN_LONG[issuer])
    y = lines(c, 40, h - 110, [title.upper()], font="Helvetica-Bold", size=13)
    y = lines(c, 40, y - 5, intro, size=9)
    y -= 10
    for label, value in fields:
        c.setFont("Helvetica", 9)
        c.drawString(40, y, label)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(230, y, value)
        c.line(225, y - 3, 560, y - 3)
        y -= 22
    y -= 10
    lines(c, 40, y, [f"Signature: ______________________    Date signed: {signed_date}"])
    footer(c)
    c.showPage()
    c.save()


def scanned_pdf(path, title_lines, body_lines):
    """Image-only PDF (no text layer) that looks like a phone scan."""
    W, H = 1275, 1650
    img = Image.new("L", (W, H), 238)
    d = ImageDraw.Draw(img)
    try:
        f_big = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
        f_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    except OSError:
        f_big = f = f_small = ImageFont.load_default()
    y = 110
    for t in title_lines:
        d.text((90, y), t, fill=30, font=f_big)
        y += 64
    y += 30
    for t in body_lines:
        d.text((90, y), t, fill=45, font=f)
        y += 52
    d.text((90, H - 80), FAKE_NOTICE, fill=110, font=f_small)
    # scanner look: noise, slight blur, slight rotation
    for _ in range(9000):
        d.point((random.randint(0, W - 1), random.randint(0, H - 1)), fill=random.randint(120, 200))
    img = img.filter(ImageFilter.GaussianBlur(0.8)).rotate(1.3, fillcolor=210, expand=False)
    img.convert("RGB").save(path, "PDF", resolution=150)


def owner_block(*pids):
    names = " and ".join(name(p).upper() for p in pids)
    return [names, PEOPLE[pids[0]]["address"]]


def acct_for(pid, custodian):
    for a in PEOPLE[pid]["accounts"]:
        if a["custodian"] == custodian:
            return a
    raise KeyError((pid, custodian))


# ---------------------------------------------------------------------------
# 3. Documents + answer key
# ---------------------------------------------------------------------------
FOLDER = {
    "Statement": "Statements", "1099": "Tax Documents", "Rollover": "Rollovers & Transfers",
    "AcctApp": "Account Applications", "RiskQ": "Risk Questionnaires", "ID": "Identification",
    "Insurance": "Insurance", "Beneficiary": "Beneficiary Forms", "Financials": "Financial Statements",
    "Trust": "Trust Documents", "Pension": "Pension Statements", "Onboarding": "Onboarding",
}


def last_token(pid):
    return PEOPLE[pid]["last"].replace("'", "").replace(" ", "")


DOCS = {}  # doc_id -> answer


def add_doc(doc_id, filename, pid, doc_type, source, yyyymm, expected="file", note=""):
    p = PEOPLE[pid] if pid else None
    DOCS[doc_id] = {
        "doc_id": doc_id,
        "attachment_filename": filename,
        "expected_outcome": expected,  # "file" or "review"
        "household_id": p["household_id"] if p else None,
        "person_id": pid,
        "doc_type": doc_type,
        "source": source,
        "date": yyyymm,
        "expected_filename": f"{yyyymm}_{last_token(pid)}-{p['first']}_{source}_{doc_type}.pdf" if p else None,
        "expected_folder": f"{p['household_id']}/{pid}/{FOLDER[doc_type]}" if p else None,
        "note": note,
    }
    return os.path.join(PDF_DIR, f"{doc_id}.pdf")


def statement(doc_id, filename, pid, custodian, q=3, show_name=True, owners=None, expected="file", note=""):
    a = acct_for(pid, custodian)
    labels = {2: ("April 1 - June 30, 2026", "06/30/2026", "2026-06"),
              3: ("July 1 - September 30, 2026", "09/30/2026", "2026-09")}
    label, end, ym = labels[q]
    path = add_doc(doc_id, filename, pid, "Statement", custodian, ym, expected, note)
    statement_pdf(path, owner_block(*(owners or [pid])), custodian, a["type"], full_acct(a["last4"]), label, end,
                  round(random.uniform(40_000, 900_000), 2), show_name=show_name)


def tax1099(doc_id, filename, pid, custodian, expected="file", note="", owner_override=None):
    a = acct_for(pid, custodian)
    path = add_doc(doc_id, filename, pid, "1099", custodian, "2025-12", expected, note)
    owner = owner_override or owner_block(pid)
    tax1099_pdf(path, owner, custodian, full_acct(a["last4"]) if not owner_override else "On file", 2025)


# --- build every document ---
statement("D01", "Statement_Q3.pdf", "P-JSMITH", "Schwab")
tax1099("D02", "1099 2025.pdf", "P-LSMITH", "Fidelity")

p = add_doc("D03", "rollover paperwork.pdf", "P-DCHEN", "Rollover", "Vanguard", "2026-10",
            note="Spouse (Mary) emailed David's rollover form")
form_pdf(p, "IRA Rollover / Transfer Request", "Vanguard",
         ["Use this form to move assets from an employer plan into an IRA."],
         [("Account owner", "David Chen"), ("Receiving IRA (last 4)", "1178"), ("Delivering plan", "Acme Corp 401(k) Plan"),
          ("Transfer amount", "Entire balance")], "10/21/2026")

statement("D04", "schwab_stmt.pdf", "P-DCHEN", "Schwab")
tax1099("D05", "vanguard tax form.pdf", "P-DCHEN", "Vanguard")

p = add_doc("D06", "risk_questionnaire_signed.pdf", "P-RPATEL", "RiskQ", "HarborPoint", "2026-10",
            note="New client onboarding form")
form_pdf(p, "Investor Risk Questionnaire", "HarborPoint", ["Please answer each question to help us understand your risk tolerance."],
         [("Client name", "Raj Patel"), ("Investment time horizon", "15+ years"), ("Reaction to a 20% decline", "Hold and rebalance"),
          ("Primary goal", "Long-term growth"), ("Risk score", "62 / 100 (Moderate Growth)")], "10/27/2026")

p = add_doc("D07", "Schwab application.pdf", "P-APATEL", "AcctApp", "Schwab", "2026-10",
            note="Different Patel household - sender email disambiguates")
form_pdf(p, "New Account Application", "Schwab", ["Individual brokerage account application."],
         [("Applicant", "Anil Patel"), ("Account type", "Individual Brokerage"), ("Employment", "Software Engineer"),
          ("Annual income", "$150,000 - $199,999"), ("Investment experience", "Moderate")], "10/29/2026")

statement("D08", "fidelity statement.pdf", "P-JSMITH", "Fidelity",
          note="Sent from personal address with misspelled name 'Jon Smyth'")

p = add_doc("D09", "scan0001.pdf", "P-CRODRIGUEZ", "ID", "DMV", "2024-03", note="Scanned driver's license, image only")
scanned_pdf(p, ["COMMONWEALTH OF MASSACHUSETTS", "DRIVER'S LICENSE"],
            ["Name: CARLOS RODRIGUEZ", "Address: 77 MISSION RD, WORCESTER MA", "DOB: 05/14/1971",
             "License No: S9X-FAKE-0001", "Issued: 03/02/2024    Expires: 05/14/2029", "Class: D"])

p = add_doc("D10", "Beneficiary form.pdf", "P-ERODRIGUEZ", "Beneficiary", "Fidelity", "2026-10")
form_pdf(p, "IRA Beneficiary Designation", "Fidelity", ["Designate beneficiaries for your IRA."],
         [("Account owner", "Elena Rodriguez"), ("Account (last 4)", "6620"), ("Primary beneficiary", "Carlos Rodriguez (spouse) 100%"),
          ("Contingent beneficiary", "Sofia Rodriguez (daughter) 100%")], "10/18/2026")

p = add_doc("D11", "life policy annual statement.pdf", "P-ERODRIGUEZ", "Insurance", "NorthwindLife", "2026-09")
form_pdf(p, "Annual Policy Statement", "NorthwindLife", ["Universal life policy annual statement."],
         [("Insured", "Elena Rodriguez"), ("Policy number", "NWL-88123"), ("Statement date", "09/30/2026"),
          ("Death benefit", "$750,000"), ("Cash value", "$61,204.17")], "09/30/2026")

statement("D12", "Q3 statement.pdf", "P-SRODRIGUEZ", "Schwab")
statement("D13", "statement.pdf", "P-MJOHNSON", "Fidelity", show_name=False,
          note="No name on document - only the account number identifies the client")
statement("D14", "Vanguard Q3.pdf", "P-KOBRIEN", "Vanguard", note="Apostrophe in last name -> OBrien")

p = add_doc("D15", "IMG_4410.pdf", "P-SOBRIEN", "Rollover", "Schwab", "2026-10", note="Scanned rollover form, image only")
scanned_pdf(p, ["CHARLES SCHWAB & CO., INC.", "IRA ROLLOVER REQUEST"],
            ["Account owner: SEAN O'BRIEN", "Receiving Rollover IRA ending: 1609", "Delivering plan: Northeast Health 403(b)",
             "Amount: Entire balance", "Signed: Sean O'Brien    Date: 10/24/2026"])

tax1099("D16", "1099.pdf", "P-TNGUYEN", "Schwab")
statement("D17", "Anna statement.pdf", "P-ANGUYEN", "Schwab", note="Husband emailed wife's statement")

p = add_doc("D18", "Mom new account.pdf", "P-LNGUYEN", "AcctApp", "Schwab", "2026-10",
            note="Daughter-in-law emailed the parent's (new client) paperwork")
form_pdf(p, "New Account Application", "Schwab", ["Individual brokerage account application."],
         [("Applicant", "Le Nguyen"), ("Account type", "Individual Brokerage"), ("Employment", "Retired"),
          ("Trusted contact", "Thomas Nguyen (son)"), ("Investment experience", "Limited")], "10/26/2026")

p = add_doc("D19", "Patel 1099.pdf", "P-RPATEL", "1099", "Schwab", "2025-12", expected="review",
            note="Unknown sender (CPA) and doc only says 'R. PATEL' - ambiguous; should go to review")
tax1099_pdf(p, ["R. PATEL", "New Jersey"], "Schwab", "On file", 2025)

p = add_doc("D20", "document.pdf", None, "Statement", "Schwab", "2026-09", expected="review",
            note="Unknown sender, person not a client - should go to review")
statement_pdf(p, ["GREGORY HALVORSEN", "61 Pine Ct, Albany, NY 12203"], "Schwab", "Individual Brokerage",
              full_acct("9999"), "July 1 - September 30, 2026", "09/30/2026", 120_450.00)

statement("D21", "Priya Q3.pdf", "P-PPATEL", "Schwab")
statement("D22", "Linda Roth Q2.pdf", "P-LSMITH", "Schwab", q=2)

p = add_doc("D23", "Northwind policy.pdf", "P-DCHEN", "Insurance", "NorthwindLife", "2026-09")
form_pdf(p, "Annual Policy Statement", "NorthwindLife", ["Term life policy annual statement."],
         [("Insured", "David Chen"), ("Policy number", "NWL-40551"), ("Statement date", "09/30/2026"),
          ("Death benefit", "$1,500,000"), ("Premium", "$1,140.00 / year")], "09/30/2026")

# --- realistic multi-page documents (styled like real custodian / insurer / plan paperwork) ---
carlos = PEOPLE["P-CRODRIGUEZ"]
p = add_doc("D24", "Fidelity Q3 2026 statement.pdf", "P-CRODRIGUEZ", "Statement", "Fidelity", "2026-09",
            note="Realistic 4-page brokerage statement")
realistic.brokerage_statement(p, "CARLOS RODRIGUEZ", ["77 Mission Rd", "Worcester, MA 01602"], "Fidelity Brokerage Services LLC",
                              "Individual - TOD", "Z41-735561", "July 1 - September 30, 2026", "2026-09-30")
p = add_doc("D25", "Smith personal balance sheet.pdf", "P-LSMITH", "Financials", "Client", "2026-09",
            note="Client-prepared balance sheet naming both spouses; first-named is Linda")
realistic.balance_sheet(p, "Linda M. Smith and John W. Smith", "September 30, 2026")
p = add_doc("D26", "Smith income statement 2025.pdf", "P-LSMITH", "Financials", "Client", "2025-12",
            note="Client-prepared household income statement")
realistic.income_statement(p, "Linda M. Smith and John W. Smith", 2025)
p = add_doc("D27", "Northwind annual policy report.pdf", "P-TNGUYEN", "Insurance", "NorthwindLife", "2026-10",
            note="Realistic 2-page universal life annual report")
realistic.insurance_report(p, "Thomas Nguyen", "402 Lake Shore Dr, Nashua, NH 03060", "NWL-UL-0442981", "October 5, 2026",
                           "Anna Nguyen (spouse) 100%")
p = add_doc("D28", "OBrien Trust certification.pdf", "P-KOBRIEN", "Trust", "Attorney", "2026-10",
            note="Certification of trust; first-named trustee is Kathleen")
realistic.trust_certification(p, "O'Brien Family Revocable Trust", "March 4, 2019", "Kathleen O'Brien and Sean O'Brien",
                              "Kathleen O'Brien and Sean O'Brien", "Margaret O'Brien-Hale", "October 20, 2026")
p = add_doc("D29", "Pension statement 2026.pdf", "P-MJOHNSON", "Pension", "Employer", "2026-09",
            note="Defined benefit pension statement")
realistic.pension_statement(p, "Mark Johnson", "5 Quarry Hill, Burlington, VT 05401", "Green Mountain Pension Plan",
                            "September 30, 2026")
p = add_doc("D30", "Harbor Point new client profile - signed.pdf", "P-APATEL", "Onboarding", "HarborPoint", "2026-10",
            note="New-client onboarding profile")
realistic.onboarding_profile(p, "Anil Patel", "anil.patel@example.net", "301 Grove St, Jersey City, NJ 07302", "10/30/2026")

# distractor attachments (should never be filed)
spam_pdf = os.path.join(PDF_DIR, "X01.pdf")
form_pdf(spam_pdf, "INVOICE #88-2231", "HarborPoint", ["PAYMENT OVERDUE. Click link to avoid account suspension."],
         [("Amount due", "$1,249.99"), ("Pay at", "http://quick-pay-alerts.example.net")], "11/01/2026")
outlook_pdf = os.path.join(PDF_DIR, "X02.pdf")
form_pdf(outlook_pdf, "2027 Market Outlook", "HarborPoint", ["Our view on rates, equities and the economy."],
         [("Webinar", "Nov 12, 2026 at 4pm ET"), ("Topic", "What the Fed means for your portfolio")], "11/01/2026")

# ---------------------------------------------------------------------------
# 4. Emails
# ---------------------------------------------------------------------------
EMAILS = []


def email(eid, frm, from_name, subject, body, attachments, expected, received, note=""):
    EMAILS.append({"id": eid, "from": frm, "fromName": from_name, "subject": subject, "body": body,
                   "receivedAt": received, "attachments": [{"docId": d, "filename": fn} for d, fn in attachments],
                   "_expected": expected, "_note": note})


def att(doc_id):
    return (doc_id, DOCS[doc_id]["attachment_filename"])


t = lambda d, h: f"2026-{d}T{h}:00-04:00"

email("E01", "john.smith@example.com", "John Smith", "Q3 statement",
      "Hi team,\n\nAttached is my Schwab statement for Q3. Let me know if you need anything else.\n\nThanks,\nJohn",
      [att("D01")], "process", t("10-28", "08:12"))
email("E02", "linda.smith@example.com", "Linda Smith", "My 1099",
      "Hello,\nHere is my Fidelity 1099 for last year that you asked for.\nLinda", [att("D02")], "process", t("10-28", "09:40"))
email("E03", "mary.chen@example.com", "Mary Chen", "David's rollover paperwork",
      "Hi! David asked me to send this over since he's traveling. It's his signed rollover form for the old Acme 401k.\n\nBest,\nMary",
      [att("D03")], "process", t("10-28", "10:05"), "Spouse emailing about the other spouse's account")
email("E04", "david.chen@example.com", "David Chen", "Docs you requested",
      "Attached are my Schwab statement and the Vanguard tax form.\n-David", [att("D04"), att("D05")], "process", t("10-28", "13:22"))
email("E05", "raj.patel@example.com", "Raj Patel", "Signed questionnaire",
      "Hi, attached is the completed risk questionnaire for our onboarding.\nRaj", [att("D06")], "process", t("10-28", "15:01"))
email("E06", "anil.patel@example.net", "Anil Patel", "Account application",
      "Please find my signed Schwab account application attached.\n\nRegards,\nAnil Patel", [att("D07")], "process", t("10-29", "08:30"))
email("E07", "jon.smyth88@example.net", "Jon Smyth", "statement",
      "hey its me, sending from my personal email. attached my fidelity statement\n\n- Jon Smyth\nsent from my phone",
      [att("D08")], "process", t("10-29", "09:15"), "Unknown address + misspelled client name")
email("E08", "carlos.rodriguez@example.com", "Carlos Rodriguez", "ID",
      "Here's a scan of my license for your records.", [att("D09")], "process", t("10-29", "11:47"))
email("E09", "elena.rodriguez@example.com", "Elena Rodriguez", "Beneficiary form + insurance statement",
      "Hi, I updated my IRA beneficiaries (form attached) and also attached my annual life insurance statement.\nThanks, Elena",
      [att("D10"), att("D11")], "process", t("10-29", "14:03"))
email("E10", "sofia.rodriguez@example.org", "Sofia Rodriguez", "Roth statement",
      "Hi, my mom said to send you my Roth statement. Attached!\nSofia", [att("D12")], "process", t("10-30", "07:55"))
email("E11", "mark.johnson@example.com", "Mark Johnson", "fwd: statement",
      "See attached.\n\nMark", [att("D13")], "process", t("10-30", "10:10"))
email("E12", "kathleen.obrien@example.com", "Kathleen O'Brien", "Vanguard statement",
      "Attached is my latest Vanguard statement.\n\nKathleen", [att("D14")], "process", t("10-30", "12:31"))
email("E13", "sean.obrien@example.com", "Sean O'Brien", "rollover form",
      "Took a picture of the signed rollover form. Hope it's readable.\nSean", [att("D15")], "process", t("10-30", "16:44"))
email("E14", "thomas.nguyen@example.com", "Thomas Nguyen", "1099 and Anna's statement",
      "Hi, attached is my 1099 and also Anna's Roth statement.\nThomas", [att("D16"), att("D17")], "process", t("10-31", "09:02"))
email("E15", "anna.nguyen@example.com", "Anna Nguyen", "Mom's new account paperwork",
      "Hi! Attached is the signed application for Thomas's mom, Le Nguyen. She's excited to get started.\nAnna",
      [att("D18")], "process", t("10-31", "11:20"))
email("E16", "frontdesk@lakeside-cpa.example.org", "Lakeside CPA Group", "1099 for Patel",
      "Hello, forwarding the 1099 for our mutual client Patel. Please confirm receipt.\n\nLakeside CPA Group",
      [att("D19")], "review", t("10-31", "13:37"), "Third party; two Patel households; doc says only 'R. PATEL'")
email("E17", "g.halvorsen@example.net", "Greg H", "please see attached",
      "please see attached statement thx", [att("D20")], "review", t("10-31", "15:15"), "Sender is not a client")
email("E18", "priya.patel@example.com", "Priya Patel", "Q3",
      "Attached my Q3 Schwab statement as requested.\nPriya", [att("D21")], "process", t("11-01", "08:48"))
email("E19", "linda.smith@example.com", "Linda Smith", "Missing Q2 Roth statement",
      "Found the Q2 statement for my Roth that was missing. Attached.\nLinda", [att("D22")], "process", t("11-01", "10:26"))
email("E20", "david.chen@example.com", "David Chen", "Life insurance",
      "Attached is the annual statement for my term life policy.\nDavid", [att("D23")], "process", t("11-01", "12:09"))

# distractors - the Intake Agent should ignore these
email("E21", "news@schwab-insights.example.com", "Market Insights Newsletter", "Statement season: 5 tips for reviewing your accounts",
      "This week's newsletter: how to read your quarterly statement, year-end tax planning, and more.\n\nUnsubscribe | Manage preferences",
      [], "ignore", t("11-01", "06:00"), "Newsletter - contains 'statement' keyword")
email("E22", "kathleen.obrien@example.com", "Kathleen O'Brien", "Can we move Thursday?",
      "Hi, something came up - could we move our review meeting to Friday at 2pm instead? Thanks!\nKathleen",
      [], "ignore", t("11-01", "14:40"), "Known client but scheduling only")
email("E23", "billing@quick-pay-alerts.example.net", "Account Billing", "URGENT: invoice attached - account suspension",
      "Your account will be suspended. Open the attached invoice and pay immediately.", [("X01", "invoice_8822.pdf")],
      "ignore", t("11-01", "17:02"), "Spam/phishing with a PDF attachment")
email("E24", "events@harborpoint-webinars.example.com", "Webinar Team", "You're invited: 2027 Market Outlook",
      "Join us for our annual outlook webinar. Brochure attached.", [("X02", "2027 Outlook.pdf")],
      "ignore", t("11-02", "07:30"), "Marketing with attachment")
email("E25", "sean.obrien@example.com", "Sean O'Brien", "did you get it?",
      "Just checking you got the rollover form I sent the other day?\nSean", [], "ignore", t("11-02", "09:12"),
      "Follow-up only, no document")

# realistic documents
email("E26", "carlos.rodriguez@example.com", "Carlos Rodriguez", "Q3 statement",
      "Hi team,\n\nAttached is my Fidelity statement for the third quarter.\n\nThanks,\nCarlos", [att("D24")], "process", t("11-02", "10:05"))
email("E27", "linda.smith@example.com", "Linda Smith", "Our financials for the planning meeting",
      "Hi,\n\nAhead of our planning meeting, attached are our personal balance sheet and last year's household income statement.\n\nBest,\nLinda",
      [att("D25"), att("D26")], "process", t("11-02", "10:40"))
email("E28", "thomas.nguyen@example.com", "Thomas Nguyen", "Life insurance annual report",
      "Hello,\n\nNorthwind sent my annual policy report. Attached for your files.\n\nThomas", [att("D27")], "process", t("11-02", "11:15"))
email("E29", "kathleen.obrien@example.com", "Kathleen O'Brien", "Trust certification",
      "Hi,\n\nOur attorney prepared the certification of trust you asked for so we can retitle the accounts. Attached.\n\nKathleen",
      [att("D28")], "process", t("11-02", "13:20"))
email("E30", "mark.johnson@example.com", "Mark Johnson", "Pension statement",
      "Attached is my pension statement from work.\n\nMark", [att("D29")], "process", t("11-02", "14:05"))
email("E31", "anil.patel@example.net", "Anil Patel", "Signed new client profile",
      "Hello,\n\nPlease find my completed and signed new client profile attached. Looking forward to working together.\n\nAnil Patel",
      [att("D30")], "process", t("11-02", "15:30"))

# ---------------------------------------------------------------------------
# 5. Write files
# ---------------------------------------------------------------------------
households_out = [{**h, "members": [{k: v for k, v in m.items()} for m in h["members"]]} for h in HOUSEHOLDS]
with open(os.path.join(OUT, "households.json"), "w") as f:
    json.dump(households_out, f, indent=2)

emails_out = [{k: v for k, v in e.items() if not k.startswith("_")} for e in EMAILS]
with open(os.path.join(OUT, "emails.json"), "w") as f:
    json.dump(emails_out, f, indent=2)

answer_key = {
    "generated": datetime(2026, 11, 2).isoformat(),
    "emails": {e["id"]: {"expected": e["_expected"], "note": e["_note"]} for e in EMAILS},
    "documents": DOCS,
}
with open(os.path.join(OUT, "answer-key.json"), "w") as f:
    json.dump(answer_key, f, indent=2)

print(f"Wrote {len(HOUSEHOLDS)} households, {len(PEOPLE)} people, {len(EMAILS)} emails, "
      f"{len(DOCS)} client documents (+2 distractor PDFs) to {OUT}")
