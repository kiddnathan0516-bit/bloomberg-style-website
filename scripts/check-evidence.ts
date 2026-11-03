// Checks the code-level evidence rule against every demo document's real PDF text.
import fs from "node:fs";
import { pdfText } from "../lib/pdf.js";
import { maskNumbers, documentMentions } from "../lib/guardrails.js";
import { personById, PEOPLE } from "../lib/directory.js";

const key = JSON.parse(fs.readFileSync("seed/data/answer-key.json", "utf8"));
let bad = 0;
for (const a of Object.values<any>(key.documents)) {
  const text = maskNumbers(await pdfText(new Uint8Array(fs.readFileSync(`seed/data/pdfs/${a.doc_id}.pdf`))));
  if (!text) { console.log(`${a.doc_id}  scanned (checked on OCR text at run time)`); continue; }
  if (a.expected_outcome === "file") {
    const r = documentMentions(text, personById(a.person_id)!);
    if (!r.ok) bad++;
    console.log(`${a.doc_id}  ${r.ok ? "PASS" : "FAIL"}  ${a.person_id}: ${r.why}`);
  } else {
    const wrong = PEOPLE.filter((p) => documentMentions(text, p).ok).map((p) => p.id);
    console.log(`${a.doc_id}  review-case: would allow ${wrong.length ? wrong.join(", ") : "nobody"}`);
  }
}
console.log(bad ? `${bad} legitimate documents FAIL` : "all legitimate text documents pass");
