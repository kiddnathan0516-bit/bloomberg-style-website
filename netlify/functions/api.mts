// The website's backend. Netlify runs this as a serverless function at /api/*.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { loadState, store, pdfKey } from "../../lib/store.js";
import {
  ingestEmail,
  loadDemoInbox,
  loadDemoEmails,
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
import { PublicError } from "../../lib/errors.js";
import demoEmails from "../../seed/data/demo-emails.json" with { type: "json" };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// ---------------------------------------------------------------------------
// Who may do what (everything fails closed: a missing setting means "no access"):
// - DEMO_PASSCODE: needed to see anything (emails, documents) and to use any button
// - INTAKE_SECRET: lets n8n send emails in, run the queue and write the summary
// ---------------------------------------------------------------------------
const digest = (s: string) => createHash("sha256").update(s).digest();
const sameSecret = (given: string | null, expected: string | undefined) =>
  !!expected && !!given && timingSafeEqual(digest(given), digest(expected));
const passcodeOk = (req: Request) => sameSecret(req.headers.get("x-passcode"), process.env.DEMO_PASSCODE);
const secretOk = (req: Request) => sameSecret(req.headers.get("x-intake-secret"), process.env.INTAKE_SECRET);

// Slow down guessing: after 10 wrong passcodes from one address in 15 minutes, refuse for a while.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const clientKey = (req: Request) => {
  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `authfail-${createHash("sha256").update(ip).digest("hex").slice(0, 16)}`;
};
async function lockedOut(req: Request) {
  const rec = await store().getJSON<{ count: number; since: number }>(clientKey(req));
  return !!rec && Date.now() - rec.since < WINDOW_MS && rec.count >= MAX_FAILS;
}
async function recordFailure(req: Request) {
  const key = clientKey(req);
  const rec = await store().getJSON<{ count: number; since: number }>(key);
  const fresh = !rec || Date.now() - rec.since >= WINDOW_MS;
  await store().setJSON(key, fresh ? { count: 1, since: Date.now() } : { count: rec!.count + 1, since: rec!.since });
}

/** Returns an error response if the caller may not proceed, otherwise null. */
async function gate(req: Request, who: "person" | "person-or-automation" | "automation") {
  if (!process.env.DEMO_PASSCODE || !process.env.INTAKE_SECRET)
    return json({ error: "The site is not set up yet: DEMO_PASSCODE and INTAKE_SECRET must be set in Netlify." }, 503);
  if (who !== "person" && secretOk(req)) return null; // n8n uses its own secret
  // During a lockout every passcode attempt is refused, even a correct one, so guessing can't continue.
  if (await lockedOut(req)) return json({ error: "Too many wrong passcodes. Try again in 15 minutes." }, 429);
  if (who !== "automation" && passcodeOk(req)) return null;
  await recordFailure(req);
  return json({ error: who === "automation" ? "bad or missing x-intake-secret" : "Passcode required" }, 401);
}

// n8n calls in with the secret. Each call is remembered as a "heartbeat", so the
// Dashboard can show that automatic scanning is running.
const heartbeat = () => store().setJSON("heartbeat", { at: new Date().toISOString() });

export default async (req: Request) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "");
  const method = req.method;
  try {
    // ---------- reading (passcode required: this is client data) ----------
    if (method === "GET") {
      const denied = await gate(req, "person");
      if (denied) return denied;
      if (route === "state") {
        const s = await loadState();
        const hb = await store().getJSON<{ at: string }>("heartbeat");
        return json({ ...s, pending: pendingCounts(s), model: MODEL, lastAutomationAt: hb?.at ?? null });
      }
      if (route === "health") {
        // Setup check. Read-only, and it only says whether each setting exists, never its value.
        const ok = await loadState().then(() => "OK", () => "PROBLEM: could not read saved data");
        return json({
          saved_data_readable: ok,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "MISSING",
          N8N_DEMO_WEBHOOK_URL: process.env.N8N_DEMO_WEBHOOK_URL ? "set" : "missing (only needed for the Gmail demo)",
          model: MODEL,
        });
      }
      if (route === "directory") return json(HOUSEHOLDS);
      if (route === "eval") return json(evaluate(await loadState()));
      if (route.startsWith("pdf/")) {
        const id = decodeURIComponent(route.slice(4));
        const bytes = await store().getBytes(pdfKey(id));
        if (!bytes) return json({ error: "not found" }, 404);
        // Untrusted files: never rendered as a page on this site's address.
        return new Response(Buffer.from(bytes), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${id.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
            "content-security-policy": "sandbox",
            "x-content-type-options": "nosniff",
            "cache-control": "private, no-store",
          },
        });
      }
      return json({ error: "not found" }, 404);
    }

    if (method !== "POST") return json({ error: "not found" }, 404);
    if (Number(req.headers.get("content-length") ?? 0) > 6_000_000) return json({ error: "Request too large" }, 413);
    const body = await req.json().catch(() => ({}));

    // ---------- automation (n8n) ----------
    if (route === "intake") {
      const denied = await gate(req, "automation");
      if (denied) return denied;
      await heartbeat();
      return json(await ingestEmail(body, "gmail"));
    }
    if (route === "work" || route === "digest") {
      const denied = await gate(req, "person-or-automation");
      if (denied) return denied;
      if (secretOk(req)) await heartbeat();
      if (route === "digest") return json(await makeDigest());
      const of = Math.max(1, Math.min(32, Number(url.searchParams.get("of")) || 1));
      const w = Math.max(0, Math.min(of - 1, Number(url.searchParams.get("w")) || 0));
      return json(await workOnce({ w, of }));
    }

    // ---------- buttons (passcode) ----------
    const denied = await gate(req, "person");
    if (denied) return denied;
    const readPdf = async (id: string) => {
      try {
        return await readSeedPdfFromDisk(id);
      } catch {
        const r = await fetch(`${url.origin}/demo-pdfs/${encodeURIComponent(id)}.pdf`);
        if (!r.ok) throw new PublicError(`Could not load demo document ${id}`, 500);
        return new Uint8Array(await r.arrayBuffer());
      }
    };
    if (route === "seed") return json(await loadDemoInbox(readPdf));
    if (route === "demo") return json(await loadDemoEmails(readPdf));
    if (route === "reset") {
      await resetState();
      return json({ ok: true });
    }
    if (route.startsWith("review/")) {
      const docId = decodeURIComponent(route.slice(7));
      return json(await reviewAction(docId, body.action, body.edit));
    }
    if (route === "live-demo") {
      // Gmail version of the demo: ask n8n to email the demo documents. Only clear the old
      // data once n8n has accepted, so a failed click doesn't leave an empty inbox.
      const hook = process.env.N8N_DEMO_WEBHOOK_URL;
      if (!hook) return json({ error: "N8N_DEMO_WEBHOOK_URL is not set in Netlify." }, 400);
      const r = await fetch(hook, {
        method: "POST",
        headers: { "content-type": "application/json", "x-intake-secret": process.env.INTAKE_SECRET ?? "" },
        body: JSON.stringify({ startedAt: Math.floor(Date.now() / 1000) }),
      }).catch(() => null);
      if (!r) return json({ error: "Could not reach n8n. Check N8N_DEMO_WEBHOOK_URL (use the Production URL)." }, 502);
      if (!r.ok) return json({ error: `n8n did not accept the request (${r.status}). Is the "Live demo" workflow Active?` }, 502);
      await resetState();
      return json({ ok: true, expected: demoEmails.length });
    }
    return json({ error: "not found" }, 404);
  } catch (err) {
    if (err instanceof PublicError) return json({ error: err.message }, err.status);
    const ref = Math.random().toString(36).slice(2, 8);
    console.error(`[error ${ref}]`, err);
    return json({ error: `Something went wrong (ref ${ref}). Please try again.` }, 500);
  }
};

export const config: Config = { path: "/api/*" };
