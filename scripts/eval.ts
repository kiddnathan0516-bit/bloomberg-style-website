// Accuracy test: runs every demo email through the REAL agents and scores the results
// against the answer key. Usage:
//   npm run eval                 (needs ANTHROPIC_API_KEY in .env or your shell)
//   npm run eval -- --workers 4  (run several agents in parallel to finish faster)
//   npm run eval -- --mock       (free scripted run, only checks the plumbing)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

try {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
process.env.LOCAL_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ria-eval-"));
const args = process.argv.slice(2);
const workers = Number(args[args.indexOf("--workers") + 1]) || 3;
if (args.includes("--mock")) (await import("./mock-model.js")).installMockModel();

const { loadDemoInbox, readSeedPdfFromDisk, workOnce, makeDigest } = await import("../lib/pipeline.js");
const { loadState } = await import("../lib/store.js");
const { evaluate } = await import("../lib/evaluate.js");
const { MODEL } = await import("../lib/llm.js");

console.log(`Model: ${args.includes("--mock") ? "MOCK (scripted)" : MODEL}, workers: ${workers}`);
await loadDemoInbox(readSeedPdfFromDisk);
const t0 = Date.now();
let runs = 0;
async function worker() {
  for (;;) {
    const r = await workOnce();
    if (r.did === "idle") return;
    if (r.did.startsWith("waiting")) {
      await new Promise((res) => setTimeout(res, 2000));
      continue;
    }
    runs++;
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${r.did}  (${r.remaining} left)`);
  }
}
await Promise.all(Array.from({ length: workers }, worker));
await makeDigest();
const ev = evaluate(await loadState());

console.log("\nPer-document results:");
for (const d of ev.docs) console.log(`  ${d.doc_id}  ${d.verdict.padEnd(15)} expected ${d.expected.padEnd(24)} got ${d.actual}`);
const wrongIntake = ev.emails.filter((e) => !e.correct);
if (wrongIntake.length) console.log("\nIntake mistakes:", wrongIntake);
console.log(`\n${runs} agent runs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`Filenames exactly right: ${ev.summary.filename_exact}/${ev.summary.filename_checked}`);
console.log(`\nHEADLINE: ${ev.headline}\n`);
fs.mkdirSync("eval-results", { recursive: true });
const out = `eval-results/eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
fs.writeFileSync(out, JSON.stringify({ model: MODEL, ...ev, state: await loadState() }, null, 2));
console.log(`Full results saved to ${out}`);
