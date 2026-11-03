// Local test server: serves the website and the /api backend on http://localhost:8888
// Usage:  npm run dev              (uses the real Claude API, needs ANTHROPIC_API_KEY in .env)
//         MOCK_LLM=1 npm run dev   (scripted fake model, free, for clicking around the UI)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

try {
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
process.env.LOCAL_STORE_DIR ||= path.resolve(".data");

if (process.env.MOCK_LLM) (await import("./mock-model.js")).installMockModel();
const handler = (await import("../netlify/functions/api.mjs")).default;
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".pdf": "application/pdf", ".json": "application/json" };
const PORT = Number(process.env.PORT || 8888);
// Same security headers as netlify.toml, so local testing matches the live site.
const SITE_HEADERS: Record<string, string> = {};
const toml = fs.readFileSync("netlify.toml", "utf8");
const block = toml.slice(toml.indexOf('for = "/*"'), toml.indexOf("[[headers]]", toml.indexOf('for = "/*"')));
for (const m of block.matchAll(/^\s*([A-Za-z-]+) = "(.*)"$/gm)) SITE_HEADERS[m[1]] = m[2];

http
  .createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const r: Response = await handler(
        new Request(url, { method: req.method, headers: req.headers as any, body: chunks.length ? Buffer.concat(chunks) : undefined }),
      );
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let file = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
    if (url.pathname.startsWith("/demo-pdfs/")) file = path.join("seed/data/pdfs", path.basename(url.pathname));
    if (url.pathname === "/demo-emails.json") file = "seed/data/demo-emails.json";
    if (!path.resolve(file).startsWith(path.resolve(".")) || !fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { ...SITE_HEADERS, "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`RIA Doc Inbox running at http://localhost:${PORT}${process.env.MOCK_LLM ? " (MOCK model)" : ""}`));
