# DriftDesk: 2-minute demo video script

Target length: about 110 seconds. Record the screen in Zoom (it makes a transcript), with `DriftDesk.html` open in Chrome at full screen.

**Before you record:** open the file, type `RESET` and press GO, then confirm. The demo then starts from the original simulated data. Type `LIVE` once so the price feed pauses and the numbers hold still while you talk.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | BOOK screen | "This is DriftDesk, a portfolio terminal for small investment-advisory firms. Advisors manage dozens of client households, and as markets move each portfolio drifts away from its target mix. Most small firms track that in spreadsheets. DriftDesk puts the whole book on one screen. Everything here is simulated data." |
| 0:15–0:30 | Click **BREACH** filter, then **DRFT** | "Five households are outside their tolerance band. The drift map shows exactly where: red means too much of a fund, blue means too little. The Ibarra-Kim household is 12.7 points heavy in US large-cap stocks." |
| 0:30–1:00 | Type `ERIKSEN` → GO. Press **Propose rebalance** | "**Interaction 1:** I open the Eriksen trust and press Propose rebalance. In one click it writes the trade list. Max drift goes from 9.6 points to zero. And it is tax-aware: it sells inside the IRA first, so the estimated tax bill is zero dollars. The Why column explains every trade." |
| 1:00–1:10 | **Stage orders** → **TRD** → **Execute** | "I stage the orders to the blotter and execute them. These are simulated fills. The household is back on target." |
| 1:10–1:30 | **RMD** → **Raise cash** on Karl Eriksen → TRD **Execute** → RMD → **Record distribution** | "**Interaction 2:** Retirees must take a required minimum distribution by December 31 or pay a 25% penalty. Karl still owes about $39,000 with 45 days left. DriftDesk sells his most over-weight fund to raise the cash, and I record the distribution. Done." |
| 1:30–1:45 | **STRS** → drag the equity slider to −30 | "**Interaction 3:** The stress test. If stocks fell 30%, I can see which clients would fall out of balance before it happens." |
| 1:45–1:55 | Type `TEST` → GO | "We tested it too: 13 automated checks on the math, all passing. DriftDesk saves a firm about 200 hours a year. Thanks for watching." |

Tips: if you finish under 90 seconds, also show the CSV export in TRD. If you run over 120 seconds, cut the stress test.
