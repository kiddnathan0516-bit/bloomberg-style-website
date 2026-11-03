// Offline plumbing test: runs the whole pipeline with a SCRIPTED fake model (no API key, no cost).
// It proves the queue, tools, guardrails, storage, digest and scoring all work together.
// The real accuracy number comes from `npm run eval`, which uses the real Claude model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

process.env.LOCAL_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ria-test-"));

const { loadDemoInbox, readSeedPdfFromDisk, workOnce, makeDigest, reviewAction } = await import("../lib/pipeline.js");
const { loadState } = await import("../lib/store.js");
const { evaluate } = await import("../lib/evaluate.js");
const { installMockModel } = await import("./mock-model.js");
installMockModel();

await loadDemoInbox(readSeedPdfFromDisk);
let steps = 0;
for (;;) {
  const r = await workOnce();
  steps++;
  if (r.did === "idle") break;
  assert.ok(!r.did.includes("error"), r.did);
  assert.ok(steps < 200, "runaway loop");
}
const digest = await makeDigest();
const s = await loadState();
const ev = evaluate(s);
console.log(`steps: ${steps}`);
console.log(`digest: ${digest.summary}`);
console.log(`eval: ${ev.headline}`);

// Assertions
assert.equal(ev.summary.misfiled, 0);
assert.equal(ev.summary.auto_filed_correctly, ev.summary.should_auto_file);
assert.equal(ev.summary.distractors_ignored, ev.summary.distractors_total);
assert.equal(ev.summary.filename_exact, ev.summary.filename_checked);
assert.equal(s.docs.D01.classification!.account_last4, "4417", "guardrail keeps last 4 only");
assert.ok(!s.docs.D01.classification!.reasoning.includes("5583-0219"), "guardrail masks full account numbers");
assert.ok(s.docs.D09.classification!.used_ocr, "scanned doc used OCR");
assert.ok(s.docs.D01.trace.some((t) => t.kind === "error" && t.text.includes("create_folder")), "agent got corrected by the folder rule");
assert.equal(s.emails.E23.status, "ignored");
assert.equal(s.docs.X01.status, "skipped");

// Human review: approve D19 under Raj Patel
await reviewAction("D19", "edit", { person_id: "P-RPATEL" });
const after = await loadState();
assert.equal(after.docs.D19.status, "filed");
assert.equal(after.docs.D19.filing!.filename, "2025-12_Patel-Raj_Schwab_1099.pdf");
await reviewAction("D20", "reject");
assert.equal((await loadState()).docs.D20.status, "rejected");
// Human releases a document the Intake Agent stopped on -> agents finish it
const { updateState } = await import("../lib/store.js");
await updateState((st) => {
  const d = st.docs.D16;
  d.status = "review";
  d.classification = undefined;
  d.filing = undefined;
  st.emails.E14.status = "needs_review";
});
await reviewAction("D16", "release");
assert.equal((await loadState()).docs.D16.status, "to_classify");
for (let i = 0; i < 5 && (await workOnce()).did !== "idle"; i++);
const released = (await loadState()).docs.D16;
assert.equal(released.status, "filed", "released doc gets filed by the agents");
assert.equal(released.filing!.person_id, "P-TNGUYEN");

console.log("ALL OFFLINE TESTS PASSED");
