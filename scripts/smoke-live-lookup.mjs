#!/usr/bin/env node
/**
 * Local smoke test of the live lookup Worker logic (no Cloudflare account needed).
 * Runs handleMatch against real HelloFresh, Blue Apron, and TheMealDB public endpoints.
 */
import { handleMatch } from "../worker/src/index.js";

const prefs = {
  beef: 2,
  chicken: 2,
  salmon: 1,
  vegetarian: 0,
  healthyOnly: true,
  servings: 4,
  avoid: ["dairy", "nuts"],
  customAvoid: [],
};

console.log("Smoke: live match with prefs", prefs);
const t0 = Date.now();
const result = await handleMatch(prefs, {});
const ms = Date.now() - t0;

console.log("ok:", result.ok);
console.log("ms:", ms);
console.log("candidateCount:", result.candidateCount);
console.log("shortages:", result.shortages);
console.log("errors:", result.errors);
if (result.slots) {
  for (const s of result.slots) {
    const m = result.candidates[s.mealId];
    console.log(
      `  ${s.day} ${s.protein}: ${m ? m.shortName : "(empty)"} [${m?.source}] steps=${m?.steps?.length || 0} healthy=${m?.healthy}`
    );
  }
}
if (!result.ok) {
  console.error("SMOKE FAIL:", result.error);
  process.exit(1);
}
// Sanity: at least one recipe per requested protein ideally
const byP = { beef: 0, chicken: 0, salmon: 0, vegetarian: 0 };
for (const m of Object.values(result.candidates)) byP[m.protein] = (byP[m.protein] || 0) + 1;
console.log("pool by protein:", byP);
if (byP.beef < 1 || byP.chicken < 1 || byP.salmon < 1) {
  console.warn("WARN: thin pool for some proteins — still ok if slots filled");
}
console.log("SMOKE OK");
