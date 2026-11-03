// The work queue that connects everything.
// Emails arrive (from n8n/Gmail or the demo button) -> queued.
// Each call to workOnce() runs ONE agent on ONE item, then saves. Small steps keep every
// call well inside Netlify's function time limit; the automation simply calls it in a loop.
import fs from "node:fs/promises";
import path from "node:path";
import emailsJson from "../seed/data/emails.json" with { type: "json" };
import { loadState, updateState, store, pdfKey, resetState } from "./store.js";
import { runIntakeAgent, keywordRules } from "./agents/intake.js";
import { runClassifierAgent } from "./agents/classifier.js";
import { runFilingAgent, folderFor } from "./agents/filer.js";
import { personById, fullName } from "./directory.js";
import { FILENAME_RE } from "./guardrails.js";
import { llmReady } from "./llm.js";
import type { AppState, Digest, DocRecord, EmailRecord, LogEntry } from "./types.js";

const now = () => new Date().toISOString();
const MAX_ATTEMPTS = 2;

function addLog(s: AppState, actor: string, message: string) {
  s.log.push({ at: now(), actor, message } satisfies LogEntry);
}

// ---------------------------------------------------------------------------
// Getting emails in
// ---------------------------------------------------------------------------
export interface IncomingEmail {
  messageId?: string;
  from: string;
  fromName?: string;
  subject?: string;
  body?: string;
  receivedAt?: string;
  attachments?: { filename: string; contentType?: string; base64: string }[];
}

export async function ingestEmail(input: IncomingEmail, source: "gmail" | "demo" = "gmail") {
  const state = await loadState();
  if (input.messageId && Object.values(state.emails).some((e) => e.messageId === input.messageId)) {
    return { duplicate: true };
  }
  const n = Object.keys(state.emails).length + 1;
  const id = `M${String(n).padStart(3, "0")}-${Math.random().toString(36).slice(2, 6)}`;
  const pdfs = (input.attachments ?? []).filter(
    (a) => a.filename?.toLowerCase().endsWith(".pdf") || a.contentType === "application/pdf",
  );
  const attachments = pdfs.map((a, i) => ({ docId: `${id}-A${i + 1}`, filename: a.filename }));
  for (const [i, a] of pdfs.entries()) {
    await store().setBytes(pdfKey(attachments[i].docId), new Uint8Array(Buffer.from(a.base64, "base64")));
  }
  const email = newEmailRecord({
    id,
    messageId: input.messageId,
    source,
    from: input.from,
    fromName: input.fromName || input.from,
    subject: input.subject || "(no subject)",
    body: input.body || "",
    receivedAt: input.receivedAt || now(),
    attachments,
  });
  await updateState((s) => {
    s.emails[id] = email;
    for (const a of attachments) s.docs[a.docId] = newDoc(a.docId, id, a.filename);
    addLog(s, "Automation", `Received email from ${email.fromName}: "${email.subject}" (${attachments.length} PDF attachment(s))`);
  });
  return { id, attachments: attachments.length };
}

function newEmailRecord(e: Omit<EmailRecord, "status" | "ruleHits" | "trace" | "attempts" | "updatedAt">): EmailRecord {
  return { ...e, status: "queued", ruleHits: keywordRules(e), trace: [], attempts: 0, updatedAt: now() };
}

function newDoc(id: string, emailId: string, originalName: string): DocRecord {
  return { id, emailId, originalName, status: "waiting", trace: [], attempts: 0, updatedAt: now() };
}

/** Loads the 25 fake demo emails and their PDFs. `readPdf` gets bytes for a seed doc id. */
export async function loadDemoInbox(readPdf: (docId: string) => Promise<Uint8Array>) {
  await resetState();
  const emails = emailsJson as Omit<EmailRecord, "status" | "ruleHits" | "trace" | "attempts" | "updatedAt" | "source">[];
  for (const e of emails) for (const a of e.attachments) await store().setBytes(pdfKey(a.docId), await readPdf(a.docId));
  await updateState((s) => {
    for (const e of emails) {
      s.emails[e.id] = newEmailRecord({ ...e, source: "demo" });
      for (const a of e.attachments) s.docs[a.docId] = newDoc(a.docId, e.id, a.filename);
    }
    addLog(s, "Automation", `Loaded demo inbox: ${emails.length} emails`);
  });
  return { emails: emails.length };
}

export async function readSeedPdfFromDisk(docId: string) {
  return new Uint8Array(await fs.readFile(path.resolve("seed/data/pdfs", `${docId}.pdf`)));
}

export { resetState };

// ---------------------------------------------------------------------------
// One unit of work
// ---------------------------------------------------------------------------
export function pendingCounts(s: AppState) {
  const emails = Object.values(s.emails).filter((e) => e.status === "queued").length;
  const classify = Object.values(s.docs).filter((d) => d.status === "to_classify").length;
  const file = Object.values(s.docs).filter((d) => d.status === "to_file").length;
  return { emails, classify, file, total: emails + classify + file };
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const free = (r: { claimedUntil?: string }) => !r.claimedUntil || r.claimedUntil < now();
const CLAIM_MS = 90_000;

/**
 * Pick the next item and "claim" it for 90 seconds, so two callers running at the same
 * time (the n8n automation and the Run-now button) never process the same item twice.
 */
/** Which parallel worker owns an email: worker `w` of `of` handles a fixed share of emails. */
export interface Share { w: number; of: number }
const ALL: Share = { w: 0, of: 1 };
const owner = (emailId: string, of: number) => [...emailId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % of;
const mine = (emailId: string, share: Share) => share.of <= 1 || owner(emailId, share.of) === share.w;

/**
 * Pick the next item in this worker's share and "claim" it for 90 seconds, so that if
 * another caller (e.g. the n8n automation) runs at the same time it skips this item.
 */
async function claimNext(share: Share): Promise<{ kind: "email" | "classify" | "file"; id: string } | null> {
  let picked: { kind: "email" | "classify" | "file"; id: string } | null = null;
  await updateState((s) => {
    const email = Object.values(s.emails).filter((e) => e.status === "queued" && free(e) && mine(e.id, share)).sort(byId)[0];
    const docs = Object.values(s.docs).filter((d) => free(d) && mine(d.emailId, share)).sort(byId);
    const classify = docs.find((d) => d.status === "to_classify");
    const file = docs.find((d) => d.status === "to_file");
    const rec = email ?? classify ?? file;
    if (!rec) return;
    rec.claimedUntil = new Date(Date.now() + CLAIM_MS).toISOString();
    picked = { kind: email ? "email" : classify ? "classify" : "file", id: rec.id };
  });
  return picked;
}

function pendingInShare(s: AppState, share: Share) {
  const emails = Object.values(s.emails).filter((e) => e.status === "queued" && mine(e.id, share)).length;
  const docs = Object.values(s.docs).filter((d) => (d.status === "to_classify" || d.status === "to_file") && mine(d.emailId, share)).length;
  return emails + docs;
}

export async function workOnce(share: Share = ALL): Promise<{ did: string; remaining: number }> {
  if (!llmReady()) {
    const remaining = pendingCounts(await loadState()).total;
    return { did: "error: ANTHROPIC_API_KEY is not set. Add it in Netlify > Site configuration > Environment variables, then redeploy.", remaining };
  }
  const next = await claimNext(share);
  if (!next) {
    const s = await loadState();
    const busy = pendingInShare(s, share);
    return { did: busy ? "waiting for items another worker is processing" : "idle", remaining: pendingCounts(s).total };
  }
  const s = await loadState();
  let did: string;
  if (next.kind === "email") did = await doIntake(s.emails[next.id]);
  else if (next.kind === "classify") did = await doClassify(s.docs[next.id], s);
  else did = await doFile(s.docs[next.id], s);
  return { did, remaining: pendingCounts(await loadState()).total };
}

async function failed(kind: "email" | "doc", id: string, actor: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await updateState((s) => {
    const rec = kind === "email" ? s.emails[id] : s.docs[id];
    if (!rec) return;
    rec.attempts += 1;
    rec.claimedUntil = undefined;
    rec.trace.push({ agent: actor, kind: "error", text: msg, at: now() });
    if (rec.attempts >= MAX_ATTEMPTS) {
      rec.status = "error";
      addLog(s, actor, `Gave up on ${id} after ${rec.attempts} attempts: ${msg}`);
    } else addLog(s, actor, `Error on ${id} (will retry): ${msg}`);
    rec.updatedAt = now();
  });
  return `${actor} error on ${id}: ${msg}`;
}

async function doIntake(email: EmailRecord) {
  try {
    const { result, trace } = await runIntakeAgent(email);
    await updateState((s) => {
      const e = s.emails[email.id];
      if (!e || e.status !== "queued") return; // another worker already handled it
      e.claimedUntil = undefined;
      e.intake = result;
      e.trace.push(...trace);
      e.updatedAt = now();
      const docs = e.attachments.map((a) => s.docs[a.docId]).filter(Boolean);
      if (result.decision === "process") {
        e.status = "processing";
        docs.forEach((d) => (d.status = "to_classify"));
      } else if (result.decision === "ignore") {
        e.status = "ignored";
        docs.forEach((d) => (d.status = "skipped"));
      } else {
        e.status = "needs_review";
        docs.forEach((d) => {
          d.status = "review";
          d.review = { reason: `Intake Agent was unsure this email is client business: ${result.reasoning}`, suggested_household_id: result.household_id, suggested_person_id: null, suggested_filename: null, confidence: result.confidence };
        });
      }
      const who = result.sender_person_id ? fullName(personById(result.sender_person_id)!) : "unknown sender";
      addLog(s, "Intake Agent", `${email.id} "${email.subject}" -> ${result.decision} (${result.category}, ${who}, conf ${result.confidence.toFixed(2)})`);
    });
    return `Intake Agent triaged ${email.id}: ${result.decision}`;
  } catch (err) {
    return failed("email", email.id, "Intake Agent", err);
  }
}

async function doClassify(doc: DocRecord, s: AppState) {
  try {
    const bytes = await store().getBytes(pdfKey(doc.id));
    if (!bytes) throw new Error("PDF missing from storage");
    const { classification, trace } = await runClassifierAgent(doc, s.emails[doc.emailId], bytes);
    await updateState((st) => {
      const d = st.docs[doc.id];
      if (!d || d.status !== "to_classify") return; // another worker already handled it
      d.claimedUntil = undefined;
      d.classification = classification;
      d.trace.push(...trace);
      d.status = "to_file";
      d.updatedAt = now();
      addLog(st, "Classifier Agent", `${doc.id} "${doc.originalName}" -> ${classification.doc_type} / ${classification.source} / ${classification.date}${classification.used_ocr ? " (OCR)" : ""}, conf ${classification.confidence.toFixed(2)}`);
    });
    return `Classifier Agent classified ${doc.id}: ${classification.doc_type}`;
  } catch (err) {
    return failed("doc", doc.id, "Classifier Agent", err);
  }
}

async function doFile(doc: DocRecord, s: AppState) {
  try {
    const r = await runFilingAgent(doc, s.emails[doc.emailId], doc.classification!, s);
    await updateState((st) => {
      const d = st.docs[doc.id];
      if (!d || d.status !== "to_file") return; // another worker already handled it: never file twice
      d.claimedUntil = undefined;
      d.trace.push(...r.trace);
      d.updatedAt = now();
      if (r.outcome === "filed") {
        d.status = "filed";
        d.filing = r.filing;
        if (!st.folders.includes(r.filing.folder)) st.folders.push(r.filing.folder);
        addLog(st, "Filing Agent", `Filed ${doc.id} as ${r.filing.folder}/${r.filing.filename} (conf ${r.filing.confidence.toFixed(2)})`);
      } else {
        d.status = "review";
        d.review = r.review;
        addLog(st, "Filing Agent", `Sent ${doc.id} to Review Queue: ${r.review.reason}`);
      }
      refreshEmailStatus(st, d.emailId);
    });
    return `Filing Agent: ${doc.id} ${r.outcome}`;
  } catch (err) {
    return failed("doc", doc.id, "Filing Agent", err);
  }
}

function refreshEmailStatus(s: AppState, emailId: string) {
  const e = s.emails[emailId];
  if (!e || e.status === "ignored") return;
  const docs = e.attachments.map((a) => s.docs[a.docId]);
  if (docs.some((d) => d.status === "review" || d.status === "error")) e.status = "needs_review";
  else if (docs.every((d) => d.status === "filed" || d.status === "rejected")) e.status = "processed";
  e.updatedAt = now();
}

// ---------------------------------------------------------------------------
// Human review actions (the human-in-the-loop part)
// ---------------------------------------------------------------------------
export async function reviewAction(
  docId: string,
  action: "approve" | "reject" | "edit" | "release",
  edit?: { person_id: string; filename?: string },
) {
  let message = "";
  await updateState((s) => {
    const d = s.docs[docId];
    if (!d) throw new Error(`No document ${docId}`);
    if (action === "reject") {
      d.status = "rejected";
      message = `Rejected ${docId} (not filed)`;
    } else if (action === "release") {
      // A person confirmed the sender is legitimate: hand the document back to the
      // Classifier and Filing agents. The confidence rules still apply to them.
      if (d.classification) throw new Error("This document was already classified. Approve or reject it instead.");
      const e = s.emails[d.emailId];
      d.status = "to_classify";
      d.review = undefined;
      d.attempts = 0;
      if (e) {
        e.status = "processing";
        if (e.intake) {
          e.intake = {
            ...e.intake,
            decision: "process",
            reasoning: `${e.intake.reasoning} [A human reviewer confirmed this sender is legitimate client business.]`,
          };
        }
      }
      message = `Human confirmed the sender of ${docId}; sent back to the agents`;
    } else {
      const personId = action === "edit" ? edit?.person_id : d.review?.suggested_person_id;
      const p = personById(personId);
      if (!p) throw new Error("Pick a client before approving.");
      if (!d.classification) throw new Error("Document was never classified; reject it or re-run.");
      const c = d.classification;
      const filename =
        (action === "edit" && edit?.filename) ||
        (d.review?.suggested_filename && d.review.suggested_person_id === p.id ? d.review.suggested_filename : null) ||
        `${c.date}_${p.last.replace(/[^A-Za-z]/g, "")}-${p.first.replace(/[^A-Za-z]/g, "")}_${c.source}_${c.doc_type}.pdf`;
      if (!FILENAME_RE.test(filename)) throw new Error(`Filename "${filename}" doesn't follow the naming convention.`);
      const folder = folderFor(p.household_id, p.id, c.doc_type);
      if (!s.folders.includes(folder)) s.folders.push(folder);
      d.status = "filed";
      d.filing = { household_id: p.household_id, person_id: p.id, folder, filename, confidence: 1, reasoning: "Approved by a human reviewer", filed_by: "human" };
      message = `Human filed ${docId} as ${folder}/${filename}`;
    }
    d.updatedAt = now();
    refreshEmailStatus(s, d.emailId);
    addLog(s, "Human", message);
  });
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// Ops digest (automation step, no AI)
// ---------------------------------------------------------------------------
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function makeDigest(): Promise<Digest> {
  let digest!: Digest;
  await updateState((s) => {
    const docs = Object.values(s.docs);
    const emails = Object.values(s.emails);
    const filed = docs.filter((d) => d.status === "filed").length;
    const needsReview = docs.filter((d) => d.status === "review" || d.status === "error").length;
    const ignored = emails.filter((e) => e.status === "ignored").length;
    const pending = pendingCounts(s).total;
    const households = new Set(docs.filter((d) => d.status === "filed").map((d) => d.filing!.household_id)).size;
    digest = {
      at: now(),
      filed,
      needsReview,
      ignored,
      pending,
      emailsProcessed: emails.filter((e) => e.status !== "queued").length,
      summary:
        `${plural(filed, "document")} filed across ${plural(households, "household")}. ` +
        `${needsReview} ${needsReview === 1 ? "needs" : "need"} human review. ` +
        `${plural(ignored, "email")} ignored (newsletters, spam, scheduling). ` +
        (pending ? `${plural(pending, "item")} still in progress.` : "Inbox is clear."),
    };
    s.digests.push(digest);
    if (s.digests.length > 50) s.digests = s.digests.slice(-50);
    addLog(s, "Automation", `Ops digest: ${digest.summary}`);
  });
  return digest;
}
