# Deliverable #3: DriftDesk

A working, single-file prototype plus investor pitch for BCOR 2205 Deliverable #3.

| File | What it is | Rubric item |
|---|---|---|
| `DriftDesk.html` | The app. Double-click to open in any browser; no install, no internet needed. | Prototype |
| `DriftDesk-Investor-Pitch.pptx` / `.pdf` | The 8-slide investor pitch, one slide per rubric row | Investor Pitch (80 pts), Gradescope |
| `VIDEO-SCRIPT.md` | Timed 90–120 s narration and click path for the screen recording | Video Demo (20 pts), Canvas |
| `PROMPTS.md` | AI prompts and troubleshooting log | Slide 6 |
| `screenshots/` | Screenshots used in the deck | Slide 4 |

## Before you submit (fill these in)
1. **Slide 1:** course section, team number and names (`[###]`, `[#]`, `[Name …]`).
2. **Slide 8:** replace `[PASTE VIDEO LINK HERE]` with your video link. In PowerPoint: right-click the text → Edit Link.
3. **Slide 6 / PROMPTS.md:** make sure the prompts match what your team actually typed.
4. Export the deck to PDF for Gradescope, and tag your teammates there and in the Canvas group.

## What the app does
DriftDesk is a portfolio rebalancing and RMD terminal for small independent advisory firms.
- **BOOK:** all 12 households, their status (OK / WATCH / BREACH) and flags. Filter, search and sort.
- **DRFT:** a heat map of drift by fund for every household. One button rebalances every household in BREACH.
- **HH:** household detail. Change the model or tolerance band and see the effect immediately. **Propose rebalance** writes a tax-aware trade list showing tax cost, turnover and drift before and after.
- **TRD:** the trade blotter. Execute (simulated), cancel, or export to CSV.
- **RMD:** what each retiree still owes before Dec 31. Raise cash, then record the distribution.
- **TLH:** taxable lots with harvestable losses and the estimated tax saved.
- **STRS:** sliders for market moves; see which households would breach their band.
- **TEST:** 13 built-in automated checks (all pass).

All data is simulated: fictitious clients, fictional "Z" funds and random-walk prices. Changes are saved in your browser. Type `RESET` to start over.
