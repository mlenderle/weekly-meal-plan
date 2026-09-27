#!/usr/bin/env node
/**
 * Worker security checks that do not call upstream recipe sites.
 */
import assert from "node:assert/strict";
import worker, {
  LIMITS,
  MAX_BODY_BYTES,
  consumeRateLimit,
  isHomeChefMeal,
  isTheMealDbMeal,
  originDecision,
  resetRateLimits,
  sanitizeMatchPrefs,
} from "../worker/src/index.js";

function acao(res) {
  return res.headers.get("access-control-allow-origin");
}

async function fetchWorker(url, init) {
  return worker.fetch(new Request(url, init), {
    ALLOWED_ORIGINS: "*,null,https://mlenderle.github.io,http://127.0.0.1:8080",
  });
}

resetRateLimits();

const health = await fetchWorker("https://weekly-meal-plan-live.example/health", {
  headers: { Origin: "https://mlenderle.github.io" },
});
assert.equal(health.status, 200);
assert.equal(acao(health), "https://mlenderle.github.io");
assert.deepEqual(await health.json(), { ok: true });
assert.equal(health.headers.get("x-content-type-options"), "nosniff");
assert.match(health.headers.get("content-security-policy"), /frame-ancestors 'none'/);

const bare = await fetchWorker("https://weekly-meal-plan-live.example/health");
assert.equal(bare.status, 200);
assert.equal(acao(bare), null);
assert.equal(JSON.stringify(await bare.json()), '{"ok":true}');

const evil = await fetchWorker("https://weekly-meal-plan-live.example/health", {
  headers: { Origin: "https://evil.example" },
});
assert.equal(evil.status, 403);
assert.equal(acao(evil), null);
assert.equal(await evil.json().then((b) => b.error), "Origin not allowed");

const suffix = await fetchWorker("https://weekly-meal-plan-live.example/match", {
  method: "POST",
  headers: { Origin: "https://mlenderle.github.io.evil.example", "Content-Type": "application/json" },
  body: "{}",
});
assert.equal(suffix.status, 403);
assert.equal(acao(suffix), null);

const nullOrigin = await fetchWorker("https://weekly-meal-plan-live.example/health", {
  headers: { Origin: "null" },
});
assert.equal(nullOrigin.status, 403);
assert.equal(acao(nullOrigin), null);

const preflightOk = await fetchWorker("https://weekly-meal-plan-live.example/match", {
  method: "OPTIONS",
  headers: { Origin: "http://127.0.0.1:8080", "Access-Control-Request-Method": "POST" },
});
assert.equal(preflightOk.status, 204);
assert.equal(acao(preflightOk), "http://127.0.0.1:8080");

const preflightNo = await fetchWorker("https://weekly-meal-plan-live.example/match", {
  method: "OPTIONS",
  headers: { Origin: "https://evil.example" },
});
assert.equal(preflightNo.status, 403);
assert.equal(acao(preflightNo), null);

const starDecision = originDecision("https://anywhere.example", "*");
assert.equal(starDecision.allow, false);
assert.equal(starDecision.cors["Access-Control-Allow-Origin"], undefined);

const prefs = sanitizeMatchPrefs({
  beef: 99,
  chicken: -4,
  salmon: 1.9,
  vegetarian: "2",
  healthyOnly: true,
  cheapBias: false,
  servings: 4,
  avoid: ["dairy", "<script>", "dairy", "not-a-real-tag"],
  customAvoid: ["<img src=x onerror=alert(1)>", "cilantro", "a", "x".repeat(80)],
});
assert.equal(prefs.error, "Cap dinners at 7 (one week).");

const okPrefs = sanitizeMatchPrefs({
  beef: 2,
  chicken: 2,
  salmon: 1,
  vegetarian: 0,
  servings: 9,
  avoid: ["nuts"],
  customAvoid: ["Cilantro!", "<b>soy</b>"],
});
assert.equal(okPrefs.prefs.beef, 2);
assert.equal(okPrefs.prefs.servings, 4);
const forcedFour = sanitizeMatchPrefs({
  beef: 1,
  chicken: 0,
  salmon: 0,
  vegetarian: 0,
  servings: 2,
});
assert.equal(forcedFour.prefs.servings, 4);
assert.deepEqual(okPrefs.prefs.avoid, ["nuts"]);
assert.deepEqual(okPrefs.prefs.customAvoid, ["cilantro", "bsoyb"]);
const cleaned = sanitizeMatchPrefs({
  beef: 1,
  chicken: 0,
  salmon: 0,
  vegetarian: 0,
  customAvoid: ["<img src=x onerror=alert(1)>", "a", "x".repeat(80)],
});
assert.deepEqual(cleaned.prefs.customAvoid, ["img srcx onerroralert1", "x".repeat(40)]);
assert.ok(cleaned.prefs.customAvoid.every((tag) => tag.length <= 40));

const huge = "x".repeat(MAX_BODY_BYTES + 50);
const tooBig = await fetchWorker("https://weekly-meal-plan-live.example/match", {
  method: "POST",
  headers: {
    Origin: "https://mlenderle.github.io",
    "Content-Type": "application/json",
    "CF-Connecting-IP": "203.0.113.10",
  },
  body: huge,
});
assert.equal(tooBig.status, 413);
assert.equal(acao(tooBig), "https://mlenderle.github.io");

resetRateLimits();
const now = Date.now();
for (let i = 0; i < LIMITS.matchPerMinute; i++) {
  const hit = consumeRateLimit("203.0.113.20", "match", now);
  assert.equal(hit.ok, true);
}
const limited = await fetchWorker("https://weekly-meal-plan-live.example/match", {
  method: "POST",
  headers: {
    Origin: "https://mlenderle.github.io",
    "Content-Type": "application/json",
    "CF-Connecting-IP": "203.0.113.20",
  },
  body: JSON.stringify({ beef: 1, chicken: 0, salmon: 0, vegetarian: 0 }),
});
assert.equal(limited.status, 429);
const limitedBody = await limited.json();
assert.equal(limitedBody.ok, false);
assert.match(limitedBody.error, /Too many recipe lookups/);
assert.ok(limitedBody.retryAfterSeconds >= 1);
assert.equal(limited.headers.get("retry-after"), String(limitedBody.retryAfterSeconds));

assert.equal(isHomeChefMeal({ source: "Home Chef", url: "https://www.homechef.com/meals/x" }, "hc-1"), true);
assert.equal(isHomeChefMeal({ source: "HelloFresh", url: "https://www.hellofresh.com/recipes/x" }, "hf-1"), false);
assert.equal(isTheMealDbMeal({ source: "TheMealDB", url: "https://www.themealdb.com/meal/52772", id: "tmdb-52772-teriyaki" }, "tmdb-52772-teriyaki"), true);
assert.equal(isTheMealDbMeal({ source: "Blue Apron", url: "https://www.blueapron.com/recipes/x" }, "ba-1"), false);

const headerBlob = [
  health.headers.get("access-control-allow-origin"),
  acao(evil),
  acao(preflightOk),
  acao(limited),
].join("|");
assert.equal(headerBlob.includes("*"), false);

console.log("security-worker: ok");
