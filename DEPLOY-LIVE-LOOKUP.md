# Deploy: Live HelloFresh / Blue Apron recipe lookup

**Repo:** https://github.com/mlenderle/weekly-meal-plan  
**Pages:** https://mlenderle.github.io/weekly-meal-plan/  
**Why a Worker:** GitHub Pages is static. Browsers cannot call HelloFresh/Blue Apron directly (CORS). A tiny Cloudflare Worker (free) fetches live recipe data server-side and returns structured kit cards to the frontend.

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

**Optional:** bind a custom route later; workers.dev is enough.

### CORS

`wrangler.toml` already allows:

- `https://mlenderle.github.io`
- localhost ports used for local preview

Edit `ALLOWED_ORIGINS` if you add another host.

### Verify Worker

```bash
curl -sS https://weekly-meal-plan-live.<subdomain>.workers.dev/health
curl -sS -X POST https://weekly-meal-plan-live.<subdomain>.workers.dev/match \
  -H 'Content-Type: application/json' \
  -d '{"beef":2,"chicken":2,"salmon":1,"vegetarian":0,"healthyOnly":true,"servings":4,"avoid":["dairy"],"customAvoid":[]}'
```

Expect `{"ok":true,"candidateCount":…,"slots":[…]}`.

## 2) Point the Pages frontend at the Worker

After deploy, either:

**A. One-time URL param (easiest)**  
Open:

`https://mlenderle.github.io/weekly-meal-plan/?liveApi=https://weekly-meal-plan-live.<subdomain>.workers.dev`

The page stores that in `localStorage` as `mealPlanLiveApiUrl`.

**B. Hardcode in `index.html`**  
Find:

```js
  // After Mitch deploys the Worker, paste the workers.dev URL here:
  return "";
```

Replace `""` with your Worker origin (no trailing slash), commit, merge to `main`.

## 3) Deploy Pages files

Push to `main` (GitHub Pages root):

1. `index.html` (live-aware UI)
2. `meal-plan-data.json` (offline demo reference)
3. `worker/` directory (source of truth for the Worker — deploy via wrangler, not Pages)
4. This `DEPLOY-LIVE-LOOKUP.md`

Suggested branch: `feature/live-recipe-lookup` → PR → merge `main`.

### Verify live Pages

1. Open Pages URL (with `?liveApi=…` if not hardcoded).
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
| Old fixed catalog | Remains embedded only for **explicit offline demo** / reference JSON — not silent primary when live is configured |

## Success criteria

- [ ] Worker deployed; `/health` and `/match` return OK  
- [ ] Pages `index.html` calls Worker on **Find matching recipes**  
- [ ] Loading state visible; picker populated from live candidates  
- [ ] Failure shows error + optional last-good — does **not** silently use only the old fixed catalog  
- [ ] Swap + PDF still work; no PII on public site  
