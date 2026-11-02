// Scores the current results against the answer key from the seed generator.
import answerKey from "../seed/data/answer-key.json" with { type: "json" };
import type { AppState } from "./types.js";

interface DocAnswer {
  doc_id: string;
  expected_outcome: "file" | "review";
  household_id: string | null;
  person_id: string | null;
  doc_type: string;
  expected_filename: string | null;
  note: string;
}

export interface DocScore {
  doc_id: string;
  verdict: "correct" | "correct_review" | "safe_review" | "misfiled" | "not_processed";
  expected: string;
  actual: string;
  filename_match: boolean | null;
  note: string;
}

export function evaluate(s: AppState) {
  const docs = Object.values(answerKey.documents as Record<string, DocAnswer>).map((a): DocScore => {
    const d = s.docs[a.doc_id];
    const expected = a.expected_outcome === "file" ? `${a.person_id} / ${a.doc_type}` : "review";
    const base = { doc_id: a.doc_id, expected, note: a.note };
    if (!d || !["filed", "review", "rejected", "skipped", "error"].includes(d.status))
      return { ...base, verdict: "not_processed", actual: d?.status ?? "missing", filename_match: null };
    // Filed by a human after review counts as "sent to review": the agents did not auto-file it.
    if (d.status === "filed" && d.filing?.filed_by === "agent") {
      const f = d.filing!;
      const actual = `${f.person_id} / ${d.classification?.doc_type}`;
      const ok = a.expected_outcome === "file" && f.person_id === a.person_id && d.classification?.doc_type === a.doc_type;
      return { ...base, verdict: ok ? "correct" : "misfiled", actual: `${actual} (${f.filename})`, filename_match: f.filename === a.expected_filename };
    }
    // review, human-filed, error, skipped or rejected = not auto-filed
    const verdict = a.expected_outcome === "review" ? "correct_review" : "safe_review";
    return { ...base, verdict, actual: d.filing?.filed_by === "human" ? "reviewed, then filed by a human" : d.status, filename_match: null };
  });

  const emails = Object.entries(answerKey.emails as Record<string, { expected: string; note: string }>).map(([id, a]) => {
    const e = s.emails[id];
    const decision = e?.intake?.decision ?? e?.status ?? "missing";
    const ok = a.expected === "ignore" ? decision === "ignore" : decision === "process" || decision === "needs_review";
    return { email_id: id, expected: a.expected, actual: decision, correct: ok, note: a.note };
  });

  const count = (v: DocScore["verdict"]) => docs.filter((d) => d.verdict === v).length;
  const shouldFile = docs.filter((d) => d.expected !== "review").length;
  const filenameChecked = docs.filter((d) => d.filename_match !== null);
  const distractors = emails.filter((e) => e.expected === "ignore");
  const summary = {
    total_docs: docs.length,
    auto_filed_correctly: count("correct"),
    should_auto_file: shouldFile,
    ambiguous_caught: count("correct_review"),
    ambiguous_total: docs.length - shouldFile,
    sent_to_review_safely: count("safe_review"),
    misfiled: count("misfiled"),
    not_processed: count("not_processed"),
    filename_exact: filenameChecked.filter((d) => d.filename_match).length,
    filename_checked: filenameChecked.length,
    distractors_ignored: distractors.filter((e) => e.correct).length,
    distractors_total: distractors.length,
    intake_correct: emails.filter((e) => e.correct).length,
    emails_total: emails.length,
  };
  const headline =
    `${summary.auto_filed_correctly}/${summary.should_auto_file} documents auto-filed correctly, ` +
    `${summary.sent_to_review_safely + summary.ambiguous_caught} sent to human review ` +
    `(${summary.ambiguous_caught}/${summary.ambiguous_total} ambiguous ones caught), ${summary.misfiled} misfiled. ` +
    `${summary.distractors_ignored}/${summary.distractors_total} junk emails ignored.`;
  return { headline, summary, docs, emails };
}
