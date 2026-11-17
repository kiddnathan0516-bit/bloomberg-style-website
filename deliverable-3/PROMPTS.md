# AI development log (for slide 6)

**Tool:** Claude (Claude Code, a coding agent that can write files and run a browser to test them).

**Our starting input:** we uploaded the class slides for workshop 6-1 (with the "Prompt 1" template: Idea, Requirements, Details), pasted the full Deliverable #3 rubric, and asked: *"build us this project based on the rubric and demo."*

> **Edit this file before submitting.** It lists the prompts in the class-template format and the problems that came up while building. Make sure it matches what your team actually typed. If you make more changes with AI yourselves, add those prompts here and on slide 6.

## Prompt 1: build (class template format)

**Idea / main purpose:** A Bloomberg-terminal-style tool for small independent investment-advisory firms. It shows every client household's drift from its target model portfolio and generates tax-aware rebalancing trades. It also tracks required minimum distributions (RMDs) and stress-tests the book against market moves.

**Requirements**
- Create a single HTML file with all CSS and JavaScript included.
- Run locally in a browser without external APIs or databases.
- Provide the complete HTML file so I can download and run it.
- Use simulated data and label it clearly as simulated.

**Details**
- Display: a client book of 12 fictitious households with AUM, model, drift and status; a drift heat map; a household detail page; a trade blotter; an RMD tracker; a tax-loss screen; and a stress test.
- Specifics (look): black background, amber text and a monospace font. A command line where you type functions such as BOOK, DRFT, RMD or a client's name. Function-key buttons along the top, and a market tape and alerts panel on the right.
- More detail: rebalancing should sell losing tax lots first, then sell inside IRAs (no tax), then the smallest long-term gains, with short-term gains last. Show the estimated tax and the drift before and after. Explain each trade.
- More detail: RMD = prior year-end balance ÷ the IRS Uniform Lifetime divisor, for Traditional IRA owners age 73 and over. Add buttons to raise cash and to record the distribution.

## Prompt 2: test
"Open the app in a browser, click through every screen and button, and check for errors. Add a built-in self-test (TEST command) that checks the math: model weights sum to 100%, drift is calculated correctly, rebalancing doesn't create or lose money, losing lots are sold first, and the RMD formula is right."

## Prompt 3: troubleshoot
"Some drift values show as -0.0, and the clock in the header is blank for the first second after loading. Fix both and re-test."

## Prompt 4: polish
"Make sure it works on a phone-width screen with no sideways scrolling, and make every trade show a plain-English reason."

## What the AI found and fixed during testing
| Problem found | Fix |
|---|---|
| Heat map showed "-0.0" for tiny negative drift | Round before formatting, so values show as "0.0" |
| Header clock was blank until the first one-second tick | Draw the clock immediately on load |
| Risk: running an old trade batch after holdings changed could sell shares that no longer exist | Execution checks every sell first and rejects the whole batch if anything changed (test #11) |
| Risk: two proposals for the same household could both be executed | Staging a new batch cancels any older staged batch for that household |
