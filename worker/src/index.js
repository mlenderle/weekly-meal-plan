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

/** Exact browser origins. `*` and the string "null" are never honored. */
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://mlenderle.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

export const LIMITS = {
  matchPerMinute: 10,
  matchPerHour: 40,
  readPerMinute: 60,
};

export const MAX_BODY_BYTES = 4096;

const AVOID_IDS = new Set([
  "dairy", "nuts", "soy", "gluten", "spicy", "mushrooms", "sesame", "egg", "mustard", "shellfish",
]);

const buckets = new Map();

export function allowedOrigins(raw) {
  const fromEnv = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "*" && s.toLowerCase() !== "null");
  return fromEnv.length ? fromEnv : DEFAULT_ALLOWED_ORIGINS.slice();
}

export function resetRateLimits() {
  buckets.clear();
}

function hitBucket(key, limit, windowMs, now) {
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > 4000) {
    for (const [k, v] of buckets) {
      if (now - v.start > 3_600_000) buckets.delete(k);
    }
  }
  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000)),
    };
  }
  return { ok: true, retryAfter: 0 };
}

/** Per-isolate fixed windows. Cloudflare sets CF-Connecting-IP; missing IPs share one bucket. */
export function consumeRateLimit(ip, kind, now = Date.now()) {
  const safeIp = String(ip || "unknown").slice(0, 80);
  if (kind === "match") {
    const minute = hitBucket(safeIp + ":match:m", LIMITS.matchPerMinute, 60_000, now);
    if (!minute.ok) return minute;
    const hour = hitBucket(safeIp + ":match:h", LIMITS.matchPerHour, 3_600_000, now);
    if (!hour.ok) return hour;
    return { ok: true, retryAfter: 0 };
  }
  return hitBucket(safeIp + ":read", LIMITS.readPerMinute, 60_000, now);
}

function clientIp(request) {
  const ip = String(request.headers.get("CF-Connecting-IP") || "").trim();
  if (ip && ip.length <= 80 && !/[\s,]/.test(ip)) return ip;
  return "unknown";
}

export function originDecision(origin, allowedRaw) {
  const list = allowedOrigins(allowedRaw);
  if (!origin) return { allow: true, cors: { Vary: "Origin" } };
  if (list.includes(origin)) {
    return {
      allow: true,
      cors: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    };
  }
  return { allow: false, cors: { Vary: "Origin" } };
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };
}

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...securityHeaders(),
      ...extraHeaders,
    },
  });
}

function clampCount(n) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(7, x));
}

export function sanitizeMatchPrefs(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Invalid JSON body" };
  }
  const prefs = {
    beef: clampCount(raw.beef),
    chicken: clampCount(raw.chicken),
    salmon: clampCount(raw.salmon),
    vegetarian: clampCount(raw.vegetarian),
    healthyOnly: raw.healthyOnly === true || raw.healthyOnly === "true",
    cheapBias: raw.cheapBias === true || raw.cheapBias === "true",
    servings: Number(raw.servings) === 4 ? 4 : 2,
    avoid: [],
    customAvoid: [],
  };
  const total = prefs.beef + prefs.chicken + prefs.salmon + prefs.vegetarian;
  if (total < 1) return { error: "Pick at least one dinner." };
  if (total > 7) return { error: "Cap dinners at 7 (one week)." };

  const avoidIn = Array.isArray(raw.avoid) ? raw.avoid : [];
  const seen = new Set();
  for (const item of avoidIn) {
    if (prefs.avoid.length >= 12) break;
    const id = String(item || "").trim().toLowerCase().slice(0, 32);
    if (!AVOID_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    prefs.avoid.push(id);
  }

  const customIn = Array.isArray(raw.customAvoid) ? raw.customAvoid : [];
  const customSeen = new Set();
  for (const item of customIn) {
    if (prefs.customAvoid.length >= 8) break;
    const tag = String(item || "")
      .toLowerCase()
      .replace(/[^a-z0-9 .,'-]/g, "")
      .trim()
      .slice(0, 40);
    if (tag.length < 2 || customSeen.has(tag)) continue;
    customSeen.add(tag);
    prefs.customAvoid.push(tag);
  }
  return { prefs };
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
      helloFresh: "public recipe search",
      blueApron: "public recipe pages",
      themealDB: "public recipe API",
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

async function readJsonLimited(request) {
  const declared = Number(request.headers.get("Content-Length") || "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { error: "Request body is too large.", status: 413 };
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { error: "Request body is too large.", status: 413 };
  }
  if (!text.trim()) return { value: {} };
  try {
    return { value: JSON.parse(text) };
  } catch (_) {
    return { error: "Invalid JSON body", status: 400 };
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const decision = originDecision(origin, env && env.ALLOWED_ORIGINS);
    const url = new URL(request.url);
    const ip = clientIp(request);

    if (!decision.allow) {
      return json({ ok: false, error: "Origin not allowed" }, 403, decision.cors);
    }

    if (request.method === "OPTIONS") {
      const limited = consumeRateLimit(ip, "read");
      if (!limited.ok) {
        return json(
          { ok: false, error: "Too many requests." },
          429,
          { ...decision.cors, "Retry-After": String(limited.retryAfter) }
        );
      }
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...decision.cors } });
    }

    if (url.pathname === "/health" || url.pathname === "/") {
      const limited = consumeRateLimit(ip, "read");
      if (!limited.ok) {
        return json(
          { ok: false, error: "Too many requests." },
          429,
          { ...decision.cors, "Retry-After": String(limited.retryAfter) }
        );
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ ok: false, error: "Not found" }, 404, decision.cors);
      }
      return json({ ok: true }, 200, decision.cors);
    }

    if (url.pathname === "/match" && request.method === "POST") {
      const limited = consumeRateLimit(ip, "match");
      if (!limited.ok) {
        return json(
          {
            ok: false,
            error: "Too many recipe lookups from this network. Wait and try again.",
            retryAfterSeconds: limited.retryAfter,
          },
          429,
          { ...decision.cors, "Retry-After": String(limited.retryAfter) }
        );
      }
      const body = await readJsonLimited(request);
      if (body.error) return json({ ok: false, error: body.error }, body.status, decision.cors);
      const sanitized = sanitizeMatchPrefs(body.value);
      if (sanitized.error) return json({ ok: false, error: sanitized.error }, 400, decision.cors);
      try {
        const result = await handleMatch(sanitized.prefs, env);
        return json(result, result.ok ? 200 : 502, decision.cors);
      } catch (err) {
        return json(
          { ok: false, error: err.message || String(err), source: "live" },
          502,
          decision.cors
        );
      }
    }

    return json({ ok: false, error: "Not found" }, 404, decision.cors);
  },
};

// Named export for local smoke tests
export { handleMatch };
