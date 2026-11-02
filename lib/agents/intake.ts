// AGENT 1: Intake Agent (email triage)
// Task: decide whether an email actually contains client documents, and who sent it.
// Steps it can choose: look up the sender's address, search names from the signature,
// open a household, then make its decision (process / ignore / needs_review).
import { FIRM_POLICY } from "../policy.js";
import { runAgent, ToolError, type AgentTool } from "../llm.js";
import { householdSummary, lookupSender, personById, searchClients } from "../directory.js";
import { clampConfidence } from "../guardrails.js";
import type { EmailRecord, IntakeResult } from "../types.js";

// Step 1 is cheap keyword rules. They are hints for the agent, not the decision.
const DOC_KEYWORDS = [
  "statement", "1099", "tax form", "rollover", "transfer", "attached", "attachment", "beneficiary",
  "account application", "application", "questionnaire", "license", "id", "insurance", "policy", "signed", "form",
];
const NOISE_KEYWORDS = ["unsubscribe", "webinar", "newsletter", "urgent", "suspend", "click", "invoice", "reschedule", "move our", "meeting"];

export function keywordRules(e: Pick<EmailRecord, "subject" | "body" | "attachments">) {
  const text = `${e.subject}\n${e.body}`.toLowerCase();
  const hits = DOC_KEYWORDS.filter((k) => new RegExp(`\\b${k}\\b`).test(text)).map((k) => `doc:${k}`);
  const noise = NOISE_KEYWORDS.filter((k) => text.includes(k)).map((k) => `noise:${k}`);
  const att = e.attachments.length ? [`attachments:${e.attachments.length}`] : ["attachments:0"];
  return [...att, ...hits, ...noise];
}

const SYSTEM = `${FIRM_POLICY}

## Your role: Intake Agent
You triage one incoming email. Decide:
1. Does this email contain client documents to file? (Newsletters, marketing, spam/phishing,
   scheduling-only and "did you get it?" follow-ups with no document are NOT.)
2. Who sent it: which client and household? Check the sender address first (lookup_sender). If that
   fails, search the name in the signature/body (search_clients) - names may be misspelled. Use
   get_household to confirm relationships when the email mentions a family member.
Then call finish_intake exactly once:
- decision "process": the email has client document attachment(s). Send it on even if you cannot
  identify the sender - the Filing Agent will use the document itself. Lower your confidence instead.
- decision "ignore": not a client-document email (give the category).
- decision "needs_review": you genuinely cannot tell whether it is legitimate client business.
Keyword rule hits are provided as hints only; think for yourself.`;

export async function runIntakeAgent(email: EmailRecord) {
  const tools: AgentTool[] = [
    {
      name: "lookup_sender",
      description: "Exact lookup of an email address in the client directory.",
      input_schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"], additionalProperties: false },
      run: ({ email }) => lookupSender(email),
    },
    {
      name: "search_clients",
      description: "Fuzzy search the client directory by a person's name (tolerates misspellings and initials).",
      input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
      run: ({ name }) => {
        const r = searchClients(name);
        return r.length ? r : `No clients resemble "${name}".`;
      },
    },
    {
      name: "get_household",
      description: "Get a household's members, their roles and their accounts (last 4 digits only).",
      input_schema: { type: "object", properties: { household_id: { type: "string" } }, required: ["household_id"], additionalProperties: false },
      run: ({ household_id }) => householdSummary(household_id),
    },
    {
      name: "finish_intake",
      description: "Record your final triage decision. Call exactly once, at the end.",
      finishes: true,
      input_schema: {
        type: "object",
        properties: {
          decision: { type: "string", enum: ["process", "ignore", "needs_review"] },
          category: {
            type: "string",
            enum: ["client_documents", "newsletter_marketing", "spam_phishing", "scheduling", "follow_up_no_document", "other"],
          },
          household_id: { type: ["string", "null"], description: "Sender's household id, or null if unknown" },
          sender_person_id: { type: ["string", "null"], description: "Sender's person id, or null if unknown" },
          sender_relationship: { type: "string", description: "e.g. 'client', 'spouse of the account owner', 'third party (CPA)', 'unknown'" },
          confidence: { type: "number", description: "0-1 confidence in the decision AND the sender match" },
          reasoning: { type: "string", description: "1-3 sentences a human reviewer can read" },
        },
        required: ["decision", "category", "household_id", "sender_person_id", "sender_relationship", "confidence", "reasoning"],
        additionalProperties: false,
      },
      run: (input: IntakeResult) => {
        if (input.sender_person_id && !personById(input.sender_person_id))
          throw new ToolError(`sender_person_id ${input.sender_person_id} is not in the directory. Use null if unknown.`);
        if (input.decision === "process" && email.attachments.length === 0)
          throw new ToolError("This email has no attachments, so there is nothing to process. Choose ignore or needs_review.");
        return { ok: true };
      },
    },
  ];

  const task = `Triage this email.

From: ${email.fromName} <${email.from}>
Received: ${email.receivedAt}
Subject: ${email.subject}
Attachments: ${email.attachments.length ? email.attachments.map((a) => a.filename).join(", ") : "(none)"}
Keyword rule hits: ${email.ruleHits.join(", ") || "(none)"}

Body:
"""
${email.body.slice(0, 4000)}
"""`;

  const run = await runAgent({ agent: "Intake Agent", system: SYSTEM, task, tools });
  const r = run.finishInput as IntakeResult;
  return { result: { ...r, confidence: clampConfidence(r.confidence) }, trace: run.trace };
}
