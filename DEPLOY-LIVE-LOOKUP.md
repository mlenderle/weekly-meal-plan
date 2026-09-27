# Deploy: Live HelloFresh / Blue Apron recipe lookup

**Repo:** https://github.com/mlenderle/weekly-meal-plan  
**Pages:** https://mlenderle.github.io/weekly-meal-plan/  
**Why a Worker:** GitHub Pages is static. Browsers cannot call HelloFresh or Blue Apron directly (CORS). A tiny Cloudflare Worker (free) fetches live recipe data server-side and returns structured recipe cards to the frontend. Live sources are those two fresh-ingredient kits only. Home Chef is par-prepared, and TheMealDB is a general recipe database, so neither is a source.

## Architecture

```
[Browser: index.html]
   POST prefs JSON ──► [Cloudflare Worker /match]
                          ├─ HelloFresh public SSR token + gw.hellofresh.com search
                          └─ Blue Apron public recipe pages (JSON-LD)
                       ◄── candidates{} + week slots[] (paraphrased steps)
   picker / swap / jsPDF (unchanged)
```

- **Primary:** live Worker response (not the old fixed ~36 catalog).
- **Fallback:** on failure, UI shows an error and optional **last-good live cache** (localStorage). Offline demo catalog is an explicit button — never a silent primary.
- **No PII** on the public site or Worker logs of personal data.
- **Copyright:** Worker paraphrases kit steps; keeps temps/times.

## Local paths ready

| Path | Role |
| --- | --- |
| `/workspace/index.html` | Pages app — calls `LIVE_API_URL/match` on **Find matching recipes** |
| `/workspace/meal-plan-data.json` | Offline demo / reference only |
| `/workspace/worker/` | Cloudflare Worker source (`wrangler.toml` + `src/`) |
| `/workspace/scripts/smoke-live-lookup.mjs` | Smoke-test Worker logic without CF account |
| `/workspace/scripts/local-live-api.mjs` | Local HTTP stand-in on `:8787` |
| `/workspace/DEPLOY-LIVE-LOOKUP.md` | This file |

## 1) Deploy the Worker (Mitch clicks these)

You need a free [Cloudflare](https://dash.cloudflare.com/) account. Deploy from a machine with Node 18+ (Mitch’s laptop or CI):

```bash
# from repo root after copying worker/ up
cd worker
npm install
npx wrangler login          # opens browser — approve once
npx wrangler deploy
```

Wrangler prints a URL like:

`https://weekly-meal-plan-live.<your-subdomain>.workers.dev`

**Optional later:** a custom domain is not part of this deploy. workers.dev is enough. Do not buy or configure a domain for this step.

### CORS

The Worker echoes `Access-Control-Allow-Origin` only when the request `Origin` is an exact allowlist entry. It never reflects an arbitrary Origin and never sends `*`. `*` and `null` in `ALLOWED_ORIGINS` are ignored. A browser origin that is not on the list gets **403** with no `Access-Control-Allow-Origin` header (not the first allowlist entry).

`wrangler.toml` allows:

- `https://mlenderle.github.io`
- `http://localhost:4173` and `http://127.0.0.1:4173`
- `http://localhost:8080` and `http://127.0.0.1:8080`

`curl` with no `Origin` still works. Do not add a custom domain here until you actually have one.

### Rate limit and request size

`POST /match` is limited per `CF-Connecting-IP` to 10 requests a minute and 40 an hour (in-isolate; free tier, no extra Cloudflare product). Over the limit the Worker returns **429** and `Retry-After` with `{ "ok": false, "error": "Too many recipe lookups..." }`. `GET /health` has a lighter cap (60 a minute). Bodies over 4 KB are **413**. Protein counts are clamped to 0–7 with a week total of 7, and avoid lists are shortened to known tags plus a few short custom phrases.

### Health

`GET /health` returns `{ "ok": true }` only. It does not list routes or provider details.

### Secrets

Nothing secret belongs in `index.html` or `wrangler.toml`. The HelloFresh token is scraped at request time from their public page; it is not stored in the repo. There is no Slack webhook. If you add an alert later, set it only with `npx wrangler secret put SLACK_WEBHOOK_URL` and do not return that URL from the Worker.

### Pages response headers (later, when a domain sits behind Cloudflare)

GitHub Pages cannot set response headers. The site ships a `<meta>` Content-Security-Policy that allows the inline app script, inline styles, and jsPDF from `cdnjs.cloudflare.com`, and `connect-src` only to the Worker above plus local port 8787. `frame-ancestors` and `X-Content-Type-Options` are ignored in a meta tag.

When you later proxy a hostname through Cloudflare (do not buy or configure that domain as part of this change), add a Response Header Transform Rule on that hostname:

| Header | Value |
| --- | --- |
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://weekly-meal-plan-live.mitch-enderle.workers.dev; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |

`'unsafe-inline'` stays until the page script is no longer inline. The Worker JSON responses already send `nosniff`, `DENY`, and `frame-ancestors 'none'`.

### Verify Worker

```bash
curl -sS https://weekly-meal-plan-live.<subdomain>.workers.dev/health
curl -sS -X POST https://weekly-meal-plan-live.<subdomain>.workers.dev/match \
  -H 'Content-Type: application/json' \
  -d '{"beef":2,"chicken":2,"salmon":1,"vegetarian":0,"healthyOnly":true,"servings":4,"avoid":["dairy"],"customAvoid":[]}'
```

Expect `{"ok":true,"candidateCount":…,"slots":[…]}`. The Worker always plans for 4 servings; a `servings` value of 2 in the body is ignored.

## 2) Point the Pages frontend at the Worker

`index.html` already calls `https://weekly-meal-plan-live.mitch-enderle.workers.dev`. That host is the only public origin the page will use. `?liveApi=` is accepted only for that host or for `http://127.0.0.1:8787` / `http://localhost:8787`. Any other value is ignored and not stored.

After you change the Worker URL, update both `LIVE_API_ALLOW` in `index.html` and the `connect-src` meta CSP together.

## 3) Deploy Pages files

Push to `main` (GitHub Pages root):

1. `index.html` (live-aware UI)
2. `meal-plan-data.json` (offline demo reference)
3. `worker/` directory (source of truth for the Worker — deploy via wrangler, not Pages)
4. This `DEPLOY-LIVE-LOOKUP.md`

Suggested branch: `feature/live-recipe-lookup` → PR → merge `main`.

### Verify live Pages

1. Open the Pages URL.
2. Confirm footer / status line shows the Worker URL.
3. Prefs: Beef 2 · Chicken 2 · Salmon 1 · Healthier · Servings 4 · Avoid Dairy (+ Nuts optional).
4. Click **Find matching recipes** → loading spinner → picker fills with **Live** badge and live match count.
5. Swap a meal; download PDF — still works.
6. Optional: DevTools → Network → `POST …/match` → 200 JSON.

If Worker is down: error message appears; **Use last successful live results** if you had a prior success; **Use offline demo catalog (not live)** is explicit only.

## Local smoke (no Cloudflare account)

Already validated on the agent box:

```bash
# Pure logic against real HF/BA public endpoints
node /workspace/scripts/smoke-live-lookup.mjs

# HTTP stand-in
node /workspace/scripts/local-live-api.mjs
# then: python3 -m http.server 4173  (from /workspace)
# open http://127.0.0.1:4173/?liveApi=http://127.0.0.1:8787
```

## Blockers / honesty

| Item | Status |
| --- | --- |
| Cloudflare account + `wrangler login` | **Required from Mitch** — cannot deploy Worker from this agent without his CF credentials |
| HelloFresh unofficial public gateway | Works today via SSR bearer on `/recipes/search`; if HF changes SSR shape, Worker token scrape breaks (error surfaces; last-good cache remains) |
| Blue Apron | No public search API found; Worker live-fetches JSON-LD from rotating public recipe URLs (discovery seeds, not a fixed kit dump) |
| TheMealDB | Not used. Not a fresh-ingredient kit. The Worker drops a meal whose source, URL, or id matches TheMealDB |
| Home Chef | Not used. Do not add it back; the Worker drops any meal whose source or URL is Home Chef |
| Old fixed catalog | Remains embedded only for **explicit offline demo** / reference JSON — not silent primary when live is configured |

## Success criteria

- [ ] Worker deployed; `/health` and `/match` return OK  
- [ ] Pages `index.html` calls Worker on **Find matching recipes**  
- [ ] Loading state visible; picker populated from live candidates  
- [ ] Failure shows error + optional last-good — does **not** silently use only the old fixed catalog  
- [ ] Swap + PDF still work; no PII on public site  
