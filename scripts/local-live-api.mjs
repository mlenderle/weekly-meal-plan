#!/usr/bin/env node
/**
 * Tiny local stand-in for the Cloudflare Worker (same handleMatch logic).
 * Usage: node scripts/local-live-api.mjs
 * Then open index.html with ?liveApi=http://127.0.0.1:8787
 */
import http from "node:http";
import { handleMatch } from "../worker/src/index.js";

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if ((url.pathname === "/" || url.pathname === "/health") && req.method === "GET") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "weekly-meal-plan-live-local" }));
    return;
  }
  if (url.pathname === "/match" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let prefs = {};
    try {
      prefs = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      return;
    }
    try {
      const result = await handleMatch(prefs, { ALLOWED_ORIGINS: "*" });
      res.writeHead(result.ok ? 200 : 502, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
    }
    return;
  }
  res.writeHead(404, { ...cors, "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local live API http://127.0.0.1:${PORT}`);
  console.log(`Frontend: open index.html with ?liveApi=http://127.0.0.1:${PORT}`);
});
