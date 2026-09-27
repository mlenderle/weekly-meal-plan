#!/usr/bin/env node
/**
 * Tiny local stand-in for the Cloudflare Worker (same fetch handler).
 * Usage: node scripts/local-live-api.mjs
 * Then open index.html with ?liveApi=http://127.0.0.1:8787
 */
import http from "node:http";
import worker from "../worker/src/index.js";

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  const hasBody = !(req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS");
  const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? body : undefined,
  });
  const response = await worker.fetch(request, {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "",
  });
  const out = Buffer.from(await response.arrayBuffer());
  const outHeaders = {};
  response.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });
  res.writeHead(response.status, outHeaders);
  res.end(out);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local live API http://127.0.0.1:${PORT}`);
  console.log(`Frontend: open index.html with ?liveApi=http://127.0.0.1:${PORT}`);
});
