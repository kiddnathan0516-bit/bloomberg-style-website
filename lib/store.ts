// Storage layer.
// On Netlify: uses Netlify Blobs (Netlify's built-in key/value storage).
// On your laptop (tests, eval): uses a local ".data/" folder so nothing needs a cloud account.
//
// Every email, document, log line and summary is its own record (key), so several agents
// working at the same time only ever write the records they are handling and never
// overwrite each other's work.
import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import type { AppState, Digest, DocRecord, EmailRecord, LogEntry } from "./types.js";

interface KV {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
  setBytes(key: string, value: Uint8Array): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

class LocalKV implements KV {
  constructor(private dir: string) {}
  private file(key: string) {
    return path.join(this.dir, key.replace(/[^A-Za-z0-9._-]/g, "_"));
  }
  async getJSON<T>(key: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(key), "utf8")) as T;
    } catch {
      return null;
    }
  }
  async setJSON(key: string, value: unknown) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(key), JSON.stringify(value));
  }
  async getBytes(key: string) {
    try {
      return new Uint8Array(await fs.readFile(this.file(key)));
    } catch {
      return null;
    }
  }
  async setBytes(key: string, value: Uint8Array) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(key), value);
  }
  async listKeys(prefix: string) {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    return names.filter((n) => n.startsWith(prefix));
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
}

class BlobKV implements KV {
  private store = getStore({ name: "ria-doc-inbox", consistency: "strong" });
  async getJSON<T>(key: string) {
    return ((await this.store.get(key, { type: "json" })) as T) ?? null;
  }
  async setJSON(key: string, value: unknown) {
    await this.store.setJSON(key, value);
  }
  async getBytes(key: string) {
    const buf = await this.store.get(key, { type: "arrayBuffer" });
    return buf ? new Uint8Array(buf) : null;
  }
  async setBytes(key: string, value: Uint8Array) {
    await this.store.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
  }
  async listKeys(prefix: string) {
    const { blobs } = await this.store.list({ prefix });
    return blobs.map((b) => b.key);
  }
  async delete(key: string) {
    await this.store.delete(key);
  }
}

let localKv: LocalKV | null = null;
export function store(): KV {
  if (process.env.LOCAL_STORE_DIR) return (localKv ??= new LocalKV(process.env.LOCAL_STORE_DIR));
  // On Netlify, open the store on every call: each request brings a fresh, short-lived
  // access token, so a store kept from an earlier request fails with "Token expired".
  try {
    return new BlobKV();
  } catch {
    return (localKv ??= new LocalKV(path.resolve(".data")));
  }
}

const P = { email: "email-", doc: "doc-", log: "log-", digest: "digest-" };
const MAX_LOG = 500;

async function readAll<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  const kv = store();
  const keys = (await kv.listKeys(prefix)).sort();
  const values = await Promise.all(keys.map((k) => kv.getJSON<T>(k)));
  return keys.map((key, i) => ({ key, value: values[i] as T })).filter((x) => x.value != null);
}

export async function loadState(): Promise<AppState> {
  const [emails, docs, log, digests] = await Promise.all([
    readAll<EmailRecord>(P.email),
    readAll<DocRecord>(P.doc),
    readAll<LogEntry>(P.log),
    readAll<Digest>(P.digest),
  ]);
  const s: AppState = {
    emails: Object.fromEntries(emails.map((e) => [e.value.id, e.value])),
    docs: Object.fromEntries(docs.map((d) => [d.value.id, d.value])),
    folders: [],
    log: log.map((l) => l.value).slice(-MAX_LOG),
    digests: digests.map((d) => d.value).slice(-50),
  };
  s.folders = [...new Set(Object.values(s.docs).filter((d) => d.status === "filed" && d.filing).map((d) => d.filing!.folder))];
  return s;
}

let seq = 0;
const stamp = () => `${String(Date.now()).padStart(15, "0")}-${String(seq++ % 1000).padStart(3, "0")}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Read the latest state, apply the change in `fn`, then save ONLY the records that changed
 * (plus any new log lines and summaries). Agents working in parallel touch different
 * records, so their saves never collide.
 */
let queue: Promise<unknown> = Promise.resolve();
export function updateState(fn: (s: AppState) => void): Promise<AppState> {
  const run = queue.then(async () => {
    const before = await loadState();
    const s: AppState = structuredClone(before);
    fn(s);
    const kv = store();
    const writes: Promise<unknown>[] = [];
    for (const [kind, prefix] of [["emails", P.email], ["docs", P.doc]] as const) {
      const old = before[kind] as Record<string, unknown>;
      const now = s[kind] as Record<string, unknown>;
      for (const [id, rec] of Object.entries(now))
        if (JSON.stringify(rec) !== JSON.stringify(old[id])) writes.push(kv.setJSON(prefix + id, rec));
      for (const id of Object.keys(old)) if (!(id in now)) writes.push(kv.delete(prefix + id));
    }
    const seenLog = new Set(before.log.map((l) => JSON.stringify(l)));
    for (const l of s.log) if (!seenLog.has(JSON.stringify(l))) writes.push(kv.setJSON(P.log + stamp(), l));
    const seenDigest = new Set(before.digests.map((d) => d.at));
    for (const d of s.digests) if (!seenDigest.has(d.at)) writes.push(kv.setJSON(P.digest + stamp(), d));
    await Promise.all(writes);
    return s;
  });
  queue = run.catch(() => {});
  return run;
}

export async function resetState() {
  const kv = store();
  for (const prefix of [P.email, P.doc, P.log, P.digest, "pdf-", "state"]) {
    const keys = await kv.listKeys(prefix);
    await Promise.all(keys.map((k) => kv.delete(k)));
  }
}

export const pdfKey = (docId: string) => `pdf-${docId}`;
