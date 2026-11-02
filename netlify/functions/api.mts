// The website's backend. Netlify runs this as a serverless function at /api/*.
import type { Config } from "@netlify/functions";
import { loadState, store, pdfKey } from "../../lib/store.js";
import {
  ingestEmail,
  loadDemoInbox,
  readSeedPdfFromDisk,
  workOnce,
  makeDigest,
  reviewAction,
  resetState,
  pendingCounts,
} from "../../lib/pipeline.js";
import { evaluate } from "../../lib/evaluate.js";
import { HOUSEHOLDS } from "../../lib/directory.js";
import { MODEL } from "../../lib/llm.js";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Who may do what:
// - anyone can look (the data is fake)
// - DEMO_PASSCODE is needed for buttons that run the AI or change data
// - INTAKE_SECRET lets n8n send emails in and run the queue
function allowed(req: Request, needs: "passcode" | "automation") {
  const pass = process.env.DEMO_PASSCODE;
  const secret = process.env.INTAKE_SECRET;
  const givenPass = req.headers.get("x-passcode");
  const givenSecret = req.headers.get("x-intake-secret");
  const passOk = !pass || givenPass === pass;
  const secretOk = !!secret && givenSecret === secret;
  return needs === "automation" ? secretOk || (!!givenPass && passOk) : passOk || secretOk;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "");
  const method = req.method;
  try {
    if (method === "GET" && route === "state") {
      const s = await loadState();
      return json({ ...s, pending: pendingCounts(s), model: MODEL, passcodeRequired: !!process.env.DEMO_PASSCODE });
    }
    if (method === "GET" && route === "directory") return json(HOUSEHOLDS);
    if (method === "GET" && route === "eval") return json(evaluate(await loadState()));
    if (method === "GET" && route.startsWith("pdf/")) {
      const bytes = await store().getBytes(pdfKey(decodeURIComponent(route.slice(4))));
      if (!bytes) return json({ error: "not found" }, 404);
      return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "cache-control": "private, max-age=300" } });
    }

    if (method !== "POST") return json({ error: "not found" }, 404);
    const body = await req.json().catch(() => ({}));

    if (route === "intake") {
      if (!allowed(req, "automation")) return json({ error: "bad or missing x-intake-secret" }, 401);
      return json(await ingestEmail(body, "gmail"));
    }
    if (route === "work") {
      if (!allowed(req, "passcode")) return json({ error: "wrong passcode" }, 401);
      return json(await workOnce());
    }
    if (route === "digest") {
      if (!allowed(req, "passcode")) return json({ error: "wrong passcode" }, 401);
      return json(await makeDigest());
    }

    if (!allowed(req, "passcode")) return json({ error: "wrong passcode" }, 401);
    if (route === "seed") {
      const origin = url.origin;
      return json(
        await loadDemoInbox(async (id) => {
          try {
            return await readSeedPdfFromDisk(id);
          } catch {
            const r = await fetch(`${origin}/demo-pdfs/${id}.pdf`);
            if (!r.ok) throw new Error(`Could not load demo PDF ${id}`);
            return new Uint8Array(await r.arrayBuffer());
          }
        }),
      );
    }
    if (route === "reset") {
      await resetState();
      return json({ ok: true });
    }
    if (route.startsWith("review/")) {
      const docId = decodeURIComponent(route.slice(7));
      return json(await reviewAction(docId, body.action, body.edit));
    }
    if (route === "check") return json({ ok: true });
    return json({ error: "not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const config: Config = { path: "/api/*" };
