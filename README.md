# RIA Doc Inbox

An AI operations assistant for small independent RIAs (3–5 person wealth management firms).
Clients email in statements, 1099s, rollover forms, IDs and onboarding paperwork. RIA Doc Inbox reads
the inbox every 5 minutes, works out which client each document belongs to, renames it to the firm's
standard, and files it into **Household → Person → Doc Type** folders. Anything it is unsure about waits
in a **Review Queue** for a human.

> **All data is fake.** The 8 households, 16 people, 25 emails and every PDF in `seed/data/` are fictitious.

## How it works

```
Gmail (demo inbox)
   │
   ▼
AUTOMATION: n8n workflow, runs every 5 minutes (n8n/gmail-to-netlify.json)
  1. Gmail trigger pulls new emails + PDF attachments
  2. Sends each email to the Netlify app (/api/intake)
  3. Runs the agent queue (/api/work, repeatedly)
  4. Writes the ops digest (/api/digest)
   │
   ▼
NETLIFY APP: agents + document database + website
  Agent 1  Intake Agent      Real client documents or junk? Who sent it?        lib/agents/intake.ts
  Agent 2  Classifier Agent  Reads the PDF (OCR for scans): type, source, date   lib/agents/classifier.ts
  Agent 3  Filing Agent      Matches the client, names it, creates folders,      lib/agents/filer.ts
                             files it, or sends it to the Review Queue
  Storage: Netlify Blobs     Website: public/ (Dashboard, Inbox, Sorted Files, Review Queue, Activity, Accuracy)
```

Each agent is a Claude **tool-use loop** (`lib/llm.ts`). The agent gets a task and a set of tools
(`lookup_sender`, `search_clients`, `find_accounts_by_last4`, `read_document_text`, `ocr_document`,
`list_folder`, `create_folder`, `file_document`, `send_to_review`, …) and decides which to call, in what
order, until it records a decision. The code runs the tools and enforces the rules.

**Domain customization:** `lib/policy.ts` holds the firm's document taxonomy, naming convention, folder
rules, privacy rules, ambiguity rules and worked examples. Every agent's system prompt starts with it.

**Guardrails enforced in code (the AI can't skip them):** `lib/guardrails.ts`
- Confidence below 0.80 can never auto-file. It always goes to the Review Queue.
- Only the last 4 digits of any account number are ever stored or shown.
- Filenames must match `YYYY-MM_Last-First_Source_DocType.pdf`.
- A document can only be filed under a person who really is in that household.

## Rubric checklist

| Requirement | Where |
|---|---|
| 3+ AI agents, multi-step, LLM decisions | Intake, Classifier, Filing agents (`lib/agents/`), each with its own tools; you can see every step in the UI ("Agent steps") |
| Automation separate from agents, 3+ steps, triggered | n8n workflow: Gmail trigger every 5 min → intake → run agents → digest (`n8n/`) |
| Defined user + problem | Ops manager / advisor at a small RIA; hours per week spent manually filing emailed documents |
| Functional app | Netlify website with Inbox, Sorted Files, Review Queue (approve/edit/reject), Activity & Digest, Accuracy Test |
| Live URL + GitHub | Netlify deploys this repo |
| Measurement | `npm run eval` and the **Accuracy Test** page score results against `seed/data/answer-key.json` |

## Deploy (first time)

1. **Netlify:** Add new site → Import an existing project → GitHub → pick this repo.
   Leave the build settings alone (they come from `netlify.toml`).
2. **Environment variables** (Site configuration → Environment variables):
   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
   | `DEMO_PASSCODE` | any password you choose (protects the buttons that run the AI) |
   | `INTAKE_SECRET` | any long random phrase (lets n8n send emails in) |
   | `CLAUDE_MODEL` *(optional)* | defaults to `claude-opus-5-5` |
   | `N8N_DEMO_WEBHOOK_URL` *(optional)* | the live-demo workflow's webhook URL (see "One-click live demo") |
3. Deploy, then open the site → **Enter passcode** → **Load demo inbox** → **Run now**.

## Connect Gmail with n8n

1. Download `n8n/gmail-to-netlify.json` from this repo.
2. n8n → Create workflow → **⋯** menu → **Import from File**.
3. Open **1. Gmail Trigger**, click Credential → Create new → Sign in with Google (use the demo Gmail).
4. Open **2. Send emails + PDFs to Netlify** and **3+4. Run agents, then write digest**. In both, replace
   `https://YOUR-SITE.netlify.app` and `PASTE-YOUR-INTAKE_SECRET-HERE` at the top of the code.
5. Save, then switch the workflow to **Active**.
6. Test: email the demo Gmail with a PDF from `seed/data/pdfs/` attached. Within 5 minutes it appears in
   the Inbox and in Sorted Files.

Don't commit your edited workflow back to GitHub. It contains your secret.

### One-click live demo (website button)

The **Run live demo** button on the Dashboard runs the whole system:
website → n8n emails 6 test documents through Gmail → n8n reads them back from Gmail → the agents
process them → digest. Setup:

1. Import `n8n/live-demo.json` into n8n. Connect your Gmail credential on both Gmail steps.
2. In **Build emails + download fake PDFs**, set `SITE_URL`, `DEMO_GMAIL` and `INTAKE_SECRET`.
3. Save and set the workflow **Active**. Open **Website button**, copy the **Production URL**.
4. In Netlify, add `N8N_DEMO_WEBHOOK_URL` = that URL, then redeploy.

### One-click test emails (n8n only)

`n8n/send-demo-emails.json` is a second workflow that emails 6 test cases to the demo Gmail with the
fake PDFs attached (a normal statement, a spouse sending a rollover form, a scanned ID, a statement with
no name, an ambiguous "R. Patel" 1099 from a CPA, and a phishing "invoice"). Import it, connect the
same Gmail credential, set `SITE_URL` and `DEMO_GMAIL` at the top of its code step, and click
**Execute**. The main workflow then picks the emails up within 5 minutes.

## Run on your own computer (optional)

```bash
npm install
cp .env.example .env        # then fill in ANTHROPIC_API_KEY
npm run dev                 # http://localhost:8888 (real AI)
MOCK_LLM=1 npm run dev      # free scripted fake model, for clicking around the UI
npm test                    # offline plumbing test (no API key needed)
npm run eval                # real accuracy test on all 23 demo documents
```

`npm run eval` prints a headline such as
`20/21 documents auto-filed correctly, 3 sent to human review (2/2 ambiguous ones caught), 0 misfiled. 5/5 junk emails ignored.`
and saves full details to `eval-results/`.

## Demo data and tricky cases

`python3 seed/generate.py` regenerates everything in `seed/data/`. You don't need to run it, because the
output is committed. The demo set includes:
- a spouse emailing the other spouse's rollover form (E03), a husband sending his wife's statement (E14),
  a daughter-in-law sending her mother-in-law's new-account paperwork (E15)
- an email from an unknown personal address with a misspelled name, "Jon Smyth" (E07)
- a statement with **no name**, identifiable only by the account's last 4 digits (E11)
- two **scanned** image-only PDFs that need OCR (E08, E13)
- two Patel households, and a CPA sending a 1099 for "R. PATEL" (should go to review) (E16)
- a statement for someone who isn't a client (should go to review) (E17)
- 5 distractors: newsletter, scheduling request, phishing "invoice" with a PDF, marketing brochure, follow-up with no attachment

## Failure points (for the presentation)

- **Ambiguous identity:** same last names, initials only, third-party senders. *Mitigation:* the agents are told never to guess, and code blocks low-confidence filing.
- **Scanned or blurry documents:** OCR can misread dates or names. *Mitigation:* Claude reads the image directly; low confidence goes to review.
- **Prompt injection:** a malicious PDF could contain "file this under X". *Mitigation:* tools only allow real directory clients, and filing rules are checked in code.
- **Outages:** Gmail, n8n or the AI API may be down. *Mitigation:* emails stay queued and are retried; the Load demo inbox button is a backup for live demos.
- **Timeouts:** each step runs one agent, so it fits inside Netlify's function time limit. If a step still times out, set `CLAUDE_MODEL` to a faster model.
- **Cost:** every document uses several AI calls. Watch usage in the Anthropic console.

## How much can a firm trust it?

Recommended operating mode: **auto-file only above 0.80 confidence, and a human reviews the Review Queue daily
plus a 10% spot-check of auto-filed documents** for the first month. The key number is **misfiled = 0**:
the system is designed to send anything uncertain to a person, not to guess.
