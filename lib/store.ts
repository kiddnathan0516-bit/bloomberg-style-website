// Storage layer.
// On Netlify: uses Netlify Blobs (Netlify's built-in key/value storage).
// On your laptop (tests, eval): uses a local ".data/" folder so nothing needs a cloud account.
import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import type { AppState } from "./types.js";

interface KV {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
  setBytes(key: string, value: Uint8Array): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
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
  async deletePrefix(prefix: string) {
    const safe = prefix.replace(/[^A-Za-z0-9._-]/g, "_");
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    await Promise.all(names.filter((n) => n.startsWith(safe)).map((n) => fs.rm(path.join(this.dir, n))));
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
  async deletePrefix(prefix: string) {
    const { blobs } = await this.store.list({ prefix });
    await Promise.all(blobs.map((b) => this.store.delete(b.key)));
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

const emptyState = (): AppState => ({ emails: {}, docs: {}, folders: [], log: [], digests: [] });

export async function loadState(): Promise<AppState> {
  return (await store().getJSON<AppState>("state")) ?? emptyState();
}

/**
 * Read-modify-write on the latest saved state. Agents can run for many seconds, so we
 * always re-read right before saving and only apply the small change in `fn`.
 */
let queue: Promise<unknown> = Promise.resolve();
export function updateState(fn: (s: AppState) => void): Promise<AppState> {
  // Updates from the same process run one at a time so they never overwrite each other.
  const run = queue.then(async () => {
    const s = await loadState();
    fn(s);
    if (s.log.length > 500) s.log = s.log.slice(-500);
    await store().setJSON("state", s);
    return s;
  });
  queue = run.catch(() => {});
  return run;
}

export async function resetState() {
  await store().setJSON("state", emptyState());
  await store().deletePrefix("pdf-");
}

export const pdfKey = (docId: string) => `pdf-${docId}`;
