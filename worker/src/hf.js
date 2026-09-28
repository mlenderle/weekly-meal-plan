/**
 * Live HelloFresh lookup via public SSR bearer token + gw recipes search.
 * No user account. Token scraped from the public recipes search page.
 */

import { makeRng, shuffle } from "./random.js";

const HF_SEARCH_PAGE = "https://www.hellofresh.com/recipes/search?q=dinner";
const HF_API = "https://gw.hellofresh.com/api/recipes/search";

const PROTEIN_QUERIES = {
  beef: ["steak dinner", "beef bowl", "sirloin", "ranch steak", "beef tenderloin"],
  chicken: ["chicken cutlets", "chicken salad dinner", "roast chicken", "chicken thighs"],
  salmon: ["salmon dinner", "salmon fillet", "glazed salmon", "salmon bowl"],
  vegetarian: [
    "vegetarian dinner",
    "veggie bowl",
    "chickpea",
    "tofu stir",
    "lentil",
    "halloumi",
    "black bean",
    "cauliflower steak",
  ],
};

/** Extra API filter strings appended for a protein (HF querystring). */
const PROTEIN_EXTRAS = {
  vegetarian: ["&tags=vegetarian", "&tags=veggie"],
};

let cachedToken = null;
let cachedTokenAt = 0;
const TOKEN_TTL_MS = 30 * 60 * 1000;

export async function getHelloFreshToken(fetchImpl = fetch) {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_TTL_MS) return cachedToken;

  const res = await fetchImpl(HF_SEARCH_PAGE, {
    headers: {
      "User-Agent": "WeeklyMealPlanner/1.0 (+https://mlenderle.github.io/weekly-meal-plan/)",
      Accept: "text/html",
    },
    cache: "no-store",
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`HF token page HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!m) throw new Error("HF __NEXT_DATA__ missing (page layout changed?)");
  const data = JSON.parse(m[1]);
  const token = data?.props?.pageProps?.ssrPayload?.serverAuth?.access_token;
  if (!token) throw new Error("HF public access_token missing in SSR payload");
  cachedToken = token;
  cachedTokenAt = now;
  return token;
}

const HF_ORDERS = ["-date", "-rating", "date"];

/**
 * Which queries, sorts, and pages to ask for. Different seeds walk different
 * slices of the catalog instead of always taking the top-rated first page.
 */
export function helloFreshSearchPlan(protein, seed) {
  const rng = makeRng(`${seed}|hf|${protein}`);
  const queries = PROTEIN_QUERIES[protein] || [protein];
  const extras = PROTEIN_EXTRAS[protein] || [""];
  const jobs = [];
  for (const q of queries) {
    for (const extra of extras) jobs.push({ q, extra });
  }
  return shuffle(jobs, rng).slice(0, 4).map((job) => ({
    q: job.q,
    extra: job.extra,
    order: HF_ORDERS[Math.floor(rng() * HF_ORDERS.length)],
    skip: Math.floor(rng() * 12),
    limit: 8,
  }));
}

async function searchOnce(token, job, fetchImpl) {
  const url =
    `${HF_API}?country=us&locale=en-US&limit=${job.limit}&take=${job.limit}&skip=${job.skip}&order=${encodeURIComponent(job.order)}&q=` +
    encodeURIComponent(job.q) +
    (job.extra || "");
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "WeeklyMealPlanner/1.0",
    },
    cache: "no-store",
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`HF search HTTP ${res.status} for q=${job.q}`);
  return res.json();
}

export async function searchHelloFreshForProtein(protein, { fetchImpl = fetch, seed = "" } = {}) {
  const token = await getHelloFreshToken(fetchImpl);
  const plan = helloFreshSearchPlan(protein, seed);
  const byId = new Map();
  for (const job of plan) {
    try {
      const data = await searchOnce(token, job, fetchImpl);
      for (const item of data.items || []) {
        if (item?.id) byId.set(item.id, item);
      }
    } catch (err) {
      console.log("hf query fail", job.q, job.extra, String(err));
    }
  }
  return [...byId.values()];
}

export async function fetchHelloFreshPool(proteinsNeeded, fetchImpl = fetch, seed = "") {
  const out = [];
  for (const protein of proteinsNeeded) {
    const items = await searchHelloFreshForProtein(protein, { fetchImpl, seed });
    out.push(...items.map((item) => ({ item, wantProtein: protein })));
  }
  return out;
}
