/**
 * Live HelloFresh lookup via public SSR bearer token + gw recipes search.
 * No user account. Token scraped from the public recipes search page.
 */

import { makeRng, shuffle } from "./random.js";

const HF_SEARCH_PAGE = "https://www.hellofresh.com/recipes/search?q=dinner";
const HF_API = "https://gw.hellofresh.com/api/recipes/search";

const PROTEIN_QUERIES = {
  beef: ["steak dinner", "sirloin steak", "flank steak", "ground beef", "beef burgers", "beef tacos"],
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
 * Four consecutive result pages. The window start moves with the seed so a
 * later search is not stuck on skip 0–11 (the same first page every time).
 */
export function helloFreshPageSkips(seed, protein) {
  const rng = makeRng(`${seed}|hf|pages|${protein}`);
  const start = Math.floor(rng() * 3) * 12;
  return [0, 1, 2, 3].map((i) => start + i * 12);
}

/**
 * Which queries, sorts, and pages to ask for. Beef always includes a steak
 * query and a ground-beef query. Different seeds walk different pages.
 */
export function helloFreshSearchPlan(protein, seed) {
  const rng = makeRng(`${seed}|hf|${protein}`);
  const skips = helloFreshPageSkips(seed, protein);
  const order = () => HF_ORDERS[Math.floor(rng() * HF_ORDERS.length)];
  if (protein === "beef") {
    const steak = shuffle(["steak dinner", "sirloin steak", "flank steak", "ribeye steak"], rng)[0];
    const ground = shuffle(["ground beef", "beef burgers", "beef tacos", "beef meatballs"], rng)[0];
    const other = shuffle(["beef stew", "brisket", "short ribs", "beef bowl"], rng)[0];
    const flip = Math.floor(rng() * 2);
    // Keep both cuts on the first two pages. A high skip on a small steak query
    // used to return nothing and the week came back all ground beef, or the reverse.
    return [
      { q: steak, extra: "", order: order(), skip: flip ? 0 : 12, limit: 8 },
      { q: ground, extra: "", order: order(), skip: flip ? 12 : 0, limit: 8 },
      { q: other, extra: "", order: order(), skip: skips[2], limit: 8 },
      { q: flip ? ground : steak, extra: "", order: order(), skip: skips[3], limit: 8 },
    ];
  }
  const queries = PROTEIN_QUERIES[protein] || [protein];
  const extras = PROTEIN_EXTRAS[protein] || [""];
  const picked = shuffle(queries, rng);
  while (picked.length < 4) picked.push(queries[picked.length % queries.length]);
  return picked.slice(0, 4).map((q, i) => ({
    q,
    extra: extras[i % extras.length] || "",
    order: order(),
    skip: skips[i],
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
