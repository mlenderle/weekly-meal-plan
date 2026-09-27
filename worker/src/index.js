/**
 * Weekly Meal Planner — live recipe match Worker
 *
 * POST /match  { beef, chicken, salmon, vegetarian, healthyOnly, servings, avoid[], customAvoid[] }
 * GET  /health
 *
 * Fetches HelloFresh, Blue Apron, and TheMealDB public recipe data.
 * Returns structured recipes (paraphrased kit steps) + proposed week slots.
 */

import { fetchHelloFreshPool } from "./hf.js";
import { fetchBlueApronPool } from "./ba.js";
import { fetchTheMealDbPool } from "./tmdb.js";
import { normalizeHelloFreshItem, normalizeJsonLdRecipe, cheapScoreFor } from "./normalize.js";
import { buildPlanFromCandidates } from "./plan.js";

function corsHeaders(origin, allowedRaw) {
  const allowed = String(allowedRaw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok =
    !origin ||
    allowed.includes("*") ||
    allowed.includes(origin) ||
    allowed.includes("null");
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function isHomeChefMeal(m, id) {
  const blob = [m && m.source, m && m.url, m && m.fetchedFrom, m && m.id, id]
    .filter(Boolean)
    .join(" ");
  return /home\s*chef|homechef\.com/i.test(blob);
}

function acceptMeal(candidates, meal) {
  if (!meal || isHomeChefMeal(meal, meal.id)) return;
  if (meal.cheapScore == null) meal.cheapScore = cheapScoreFor(meal.ingredients);
  if (!candidates[meal.id]) candidates[meal.id] = meal;
}

async function handleMatch(prefs, env) {
  const proteinsNeeded = [];
  for (const p of ["beef", "chicken", "salmon", "vegetarian"]) {
    if ((Number(prefs[p]) || 0) > 0) proteinsNeeded.push(p);
  }
  if (!proteinsNeeded.length) {
    return { ok: false, error: "Pick at least one dinner." };
  }

  const errors = [];
  const candidates = {};

  // --- HelloFresh live ---
  try {
    const pool = await fetchHelloFreshPool(proteinsNeeded);
    for (const { item, wantProtein } of pool) {
      const norm = normalizeHelloFreshItem(item);
      if (!norm) continue;
      // Strict: only accept the protein we searched for on that query path
      // (prevents fish/chicken leaking into vegetarian searches).
      if (norm.protein !== wantProtein) continue;
      acceptMeal(candidates, norm);
    }
  } catch (err) {
    errors.push("HelloFresh: " + (err.message || String(err)));
  }

  // --- Blue Apron live JSON-LD ---
  try {
    const ba = await fetchBlueApronPool();
    for (const { ld, url } of ba) {
      const norm = normalizeJsonLdRecipe(ld, "Blue Apron", url);
      if (!norm) continue;
      if (!proteinsNeeded.includes(norm.protein)) continue;
      acceptMeal(candidates, norm);
    }
  } catch (err) {
    errors.push("Blue Apron: " + (err.message || String(err)));
  }

  // --- TheMealDB public filter + lookup ---
  try {
    const tmdb = await fetchTheMealDbPool(proteinsNeeded);
    for (const norm of tmdb) acceptMeal(candidates, norm);
  } catch (err) {
    errors.push("TheMealDB: " + (err.message || String(err)));
  }

  for (const id of Object.keys(candidates)) {
    if (isHomeChefMeal(candidates[id], id)) delete candidates[id];
  }

  const count = Object.keys(candidates).length;
  if (count < 1) {
    return {
      ok: false,
      error: "Live lookup returned no usable dinners. " + (errors.join(" ") || "Try again shortly."),
      errors,
      source: "live",
    };
  }

  const plan = buildPlanFromCandidates(candidates, prefs);
  if (plan.error) {
    return { ok: false, error: plan.error, candidates, source: "live" };
  }

  return {
    ok: true,
    source: "live",
    fetchedAt: new Date().toISOString(),
    providerNotes: {
      helloFresh: "public gw.hellofresh.com search via SSR bearer",
      blueApron: "public recipe pages JSON-LD (seed URL discovery, live fetch)",
      themealDB: "free public API (no key) — filter + lookup",
      cheapBias: "When cheapBias=true, prefer higher cheapScore (staples / shorter lists; not store prices)",
      copyright: "Steps paraphrased; temps/times retained",
    },
    errors: errors.length ? errors : undefined,
    candidates,
    candidateCount: count,
    slots: plan.slots,
    shortages: plan.shortages,
    total: plan.total,
    servings: prefs.servings === 4 ? 4 : 2,
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health" || url.pathname === "/") {
      return json(
        {
          ok: true,
          service: "weekly-meal-plan-live",
          endpoints: ["GET /health", "POST /match"],
        },
        200,
        cors
      );
    }

    if (url.pathname === "/match" && request.method === "POST") {
      let prefs;
      try {
        prefs = await request.json();
      } catch (_) {
        return json({ ok: false, error: "Invalid JSON body" }, 400, cors);
      }
      try {
        const result = await handleMatch(prefs || {}, env);
        return json(result, result.ok ? 200 : 502, cors);
      } catch (err) {
        return json(
          { ok: false, error: err.message || String(err), source: "live" },
          502,
          cors
        );
      }
    }

    return json({ ok: false, error: "Not found" }, 404, cors);
  },
};

// Named export for local smoke tests
export { handleMatch };
