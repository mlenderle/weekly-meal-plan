# weekly-meal-plan

A public preference-driven weekly meal planner. Choose beef, chicken, salmon, and vegetarian counts, healthier or anything-goes, servings for 2 or 4, and foods to avoid. **Find matching recipes** looks up HelloFresh and Blue Apron dinners live through a small [Cloudflare Worker](worker/), then lets you swap dinners and download a PDF with a cover, grocery list, and one page per recipe.

**Pages:** https://mlenderle.github.io/weekly-meal-plan/

## Live lookup

GitHub Pages is static, so the browser cannot call HelloFresh or Blue Apron directly (CORS). The Worker in `worker/` fetches public recipe data server-side and returns kit cards to `index.html`.

**Find matching recipes** posts your preferences to the Worker at `https://weekly-meal-plan-live.mitch-enderle.workers.dev/match`. The page only accepts that host, or `http://127.0.0.1:8787` / `http://localhost:8787` for a local Worker. A `?liveApi=` value pointing anywhere else is ignored. Steps are in [DEPLOY-LIVE-LOOKUP.md](DEPLOY-LIVE-LOOKUP.md).

## Offline demo

`meal-plan-data.json` (and the catalog embedded in the page) is an **explicit fallback only**. A failed or unconfigured live lookup shows an error and does not silently fill the week from the old fixed catalog. **Use offline demo catalog (not live)** loads that demo on purpose. If a previous live response succeeded in this browser, **Use last successful live results** can restore it.
