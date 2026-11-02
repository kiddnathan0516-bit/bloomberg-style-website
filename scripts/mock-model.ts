// A SCRIPTED fake model used only for offline tests and UI demos without an API key.
// It "answers" using the answer key, so it proves the plumbing, NOT the AI's accuracy.
import fs from "node:fs";
import { setCreateOverride } from "../lib/llm.js";
import { lookupSender } from "../lib/directory.js";

const key = JSON.parse(fs.readFileSync("seed/data/answer-key.json", "utf8"));
const emails = JSON.parse(fs.readFileSync("seed/data/emails.json", "utf8"));

export function installMockModel() {
let n = 0;
const reply = (content: any[]) => ({ id: `msg_${n++}`, type: "message", role: "assistant", model: "fake", content, stop_reason: content.some((c) => c.type === "tool_use") ? "tool_use" : "end_turn", usage: {} }) as any;
const use = (name: string, input: unknown) => ({ type: "tool_use", id: `tu_${n++}`, name, input });
const lastToolResult = (p: any) => {
  const last = p.messages[p.messages.length - 1];
  return Array.isArray(last.content) ? String(last.content.find((c: any) => c.type === "tool_result")?.content ?? "") : "";
};
const taskText = (p: any) => (typeof p.messages[0].content === "string" ? p.messages[0].content : "");

  setCreateOverride(async (p: any) => {
  const sys = Array.isArray(p.system) ? p.system[0].text : "";
  const turn = p.messages.filter((m: any) => m.role === "assistant").length;
  if (!sys) return reply([{ type: "text", text: "COMMONWEALTH OF MASSACHUSETTS DRIVER'S LICENSE Name: SCANNED PERSON" }]); // OCR call

  if (sys.includes("Your role: Intake Agent")) {
    const from = /From: .*<(.+)>/.exec(taskText(p))![1];
    const e = emails.find((x: any) => x.from === from && taskText(p).includes(`Subject: ${x.subject}`));
    if (turn === 0) return reply([use("lookup_sender", { email: from })]);
    const exp = key.emails[e.id].expected;
    const s: any = lookupSender(from);
    return reply([use("finish_intake", {
      decision: exp === "ignore" ? "ignore" : "process", category: exp === "ignore" ? "other" : "client_documents",
      household_id: s.household_id ?? null, sender_person_id: s.person_id ?? null, sender_relationship: "client",
      confidence: 0.9, reasoning: "scripted",
    })]);
  }
  if (sys.includes("Your role: Classifier Agent")) {
    const t = taskText(p);
    const fname = /Attachment filename: (.+)/.exec(t)![1];
    const from = /from .* <(.+)> with subject/.exec(t)![1];
    const em = emails.find((x: any) => x.from === from && x.attachments.some((a: any) => a.filename === fname));
    const docId = em.attachments.find((a: any) => a.filename === fname).docId;
    const a = key.documents[docId];
    if (turn === 0) return reply([use("read_document_text", {})]);
    if (lastToolResult(p).startsWith("NO_TEXT_LAYER")) return reply([use("ocr_document", {})]);
    return reply([use("finish_classification", {
      doc_type: a.doc_type, source: a.source, date: a.date, names_on_document: [], account_last4: "1111-2222-4417",
      statement_period: null, ending_balance: null, confidence: 0.95, reasoning: "Account 5583-0219-4417 seen",
    })]);
  }
  if (sys.includes("Your role: Filing Agent")) {
    const docId = /Document id: (\S+)/.exec(taskText(p))![1];
    const a = key.documents[docId];
    if (a.expected_outcome === "review")
      return reply([use("send_to_review", { reason: "ambiguous", suggested_household_id: null, suggested_person_id: null, suggested_filename: null, confidence: 0.4 })]);
    if (turn === 0) return reply([use("file_document", { household_id: a.household_id, person_id: a.person_id, filename: a.expected_filename, confidence: 0.95, reasoning: "x" })]); // should fail: folder missing
    if (turn === 1) return reply([use("create_folder", { folder: a.expected_folder })]);
    return reply([use("file_document", { household_id: a.household_id, person_id: a.person_id, filename: a.expected_filename, confidence: 0.95, reasoning: "scripted" })]);
  }
  throw new Error("unexpected agent");
});

}
