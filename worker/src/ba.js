/**
 * Live Blue Apron recipes.
 *
 * www.blueapron.com sits behind a Cloudflare challenge for many server IPs, and
 * current recipe pages no longer ship schema.org JSON-LD. Discovery uses recent
 * public recipe URLs (plus the Internet Archive CDX index when it answers).
 * Each page is fetched live first. A challenge or a non-recipe response falls
 * back to that URL's archived HTML. Ingredients and steps are parsed from the
 * embedded preparation payload, then dropped later if they disagree.
 */

import { makeRng, shuffle } from "./random.js";
import { BA_CATALOG } from "./ba-catalog.js";

export const BA_SEED_URLS = BA_CATALOG.map((row) => row.url);

const CDX_URL =
  "https://web.archive.org/cdx/search/cdx?url=www.blueapron.com/recipes/standard-meal-kit/&matchType=prefix&output=json&fl=original,timestamp&filter=statuscode:200&from=20260101&collapse=urlkey&limit=250";

const HTML_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; WeeklyMealPlanner/1.0; +https://mlenderle.github.io/weekly-meal-plan/)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

let catalogCache = null;
let catalogCachedAt = 0;
const CATALOG_TTL_MS = 30 * 60 * 1000;

/** Different seeds pick a different subset. The same seed stays stable. */
export function blueApronSeedPlan(seed, count = 8, urls = BA_SEED_URLS) {
  const rng = makeRng(`${seed}|ba`);
  return shuffle(urls, rng).slice(0, Math.min(count, urls.length));
}

export function blueApronSlugProtein(url) {
  const slug = String(url || "").split("?")[0].split("/").filter(Boolean).pop() || "";
  const s = slug.toLowerCase();
  if (!s) return null;
  if (/salmon/.test(s)) return "salmon";
  if (/chicken/.test(s)) return "chicken";
  if (/pancetta|prosciutto|turkey|pork|shrimp|scallop|lamb|cod|tilapia|tuna/.test(s)
    && !/beef|steak|burger|chicken|salmon/.test(s)) {
    return null;
  }
  if (/beef|steak|sirloin|brisket|flank|burger|bolognese|cheesesteak/.test(s)) {
    if (/turkey|pork|black-bean|chickpea/.test(s)) return null;
    return "beef";
  }
  if (/tofu|chickpea|falafel|lentil|cauliflower|halloumi|black-bean|quinoa|mushroom/.test(s)
    && !/chicken|beef|steak|salmon|shrimp|pork|bacon|sausage|pancetta/.test(s)) {
    return "vegetarian";
  }
  return null;
}

function beefSlugCut(url) {
  const s = String(url || "").toLowerCase();
  if (/steak|sirloin|flank|brisket|rib-eye|ribeye/.test(s)) return "steak";
  if (/burger|bolognese|cheesesteak|bao|meatball/.test(s)) return "ground";
  return "other";
}

export function selectBlueApronTargets(catalog, proteins, seed, perProtein = 3) {
  const rng = makeRng(`${seed}|ba|pick`);
  const rows = Array.isArray(catalog) ? catalog : [];
  const wanted = proteins && proteins.length ? proteins : ["beef", "chicken", "salmon", "vegetarian"];
  const picked = [];
  for (const protein of wanted) {
    const matching = shuffle(rows.filter((row) => blueApronSlugProtein(row.url) === protein), rng);
    if (protein === "beef") {
      const chosen = [];
      const steaks = matching.filter((row) => beefSlugCut(row.url) === "steak");
      const grounds = matching.filter((row) => beefSlugCut(row.url) === "ground");
      if (steaks[0]) chosen.push(steaks[0]);
      if (grounds[0]) chosen.push(grounds[0]);
      if (steaks[1]) chosen.push(steaks[1]);
      if (grounds[1]) chosen.push(grounds[1]);
      for (const row of matching) {
        if (chosen.length >= Math.max(perProtein, 4)) break;
        if (!chosen.includes(row)) chosen.push(row);
      }
      picked.push(...chosen.slice(0, Math.max(perProtein, 4)));
    } else {
      picked.push(...matching.slice(0, perProtein));
    }
  }
  const seen = new Set();
  return picked.filter((row) => {
    if (!row || !row.url || seen.has(row.url)) return false;
    seen.add(row.url);
    return true;
  }).slice(0, 9);
}

function unescapeEmbedded(html) {
  return String(html || "")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u0027/gi, "'")
    .replace(/\\"/g, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&deg;/gi, "°");
}

function extractJsonArray(text, key) {
  const marker = `"${key}":`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf("[", at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = stripTags((h1 && h1[1]) || (title && title[1]) || "");
  const cleaned = raw.replace(/\s*[|\-–]\s*Blue Apron.*$/i, "").trim();
  if (!cleaned || /^blue apron$/i.test(cleaned)) return "";
  return cleaned;
}

function jsonLdRecipe(html) {
  const blocks = [...String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1]);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const types = node && node["@type"];
        const isRecipe = types === "Recipe" || (Array.isArray(types) && types.includes("Recipe"));
        if (isRecipe) return node;
      }
    } catch (_) {}
  }
  return null;
}

function recipeFromPayload(text, url) {
  const ingredients = extractJsonArray(text, "ingredients");
  const steps = extractJsonArray(text, "preparation_steps");
  if (!Array.isArray(ingredients) || !ingredients.length || !Array.isArray(steps) || !steps.length) return null;
  const lines = ingredients.map((item) => {
    const name = stripTags(item && (item.name || item.ingredient || ""));
    const qty = stripTags(item && (item.quantity_unicode_str || item.quantity || ""));
    return [qty, name].filter(Boolean).join(" ").trim();
  }).filter(Boolean);
  const instructions = steps.map((step) => {
    const title = stripTags(step && step.title);
    const body = stripTags(step && (step.instruction || step.text || ""));
    return [title, body].filter(Boolean).join(". ");
  }).filter((line) => line.length > 8);
  const name = pageTitle(text);
  if (!name || lines.length < 3 || instructions.length < 2) return null;
  return { name, ingredients: lines, steps: instructions, url: url || "" };
}

/** Pull a recipe from a Blue Apron HTML page, or null when the page has none. */
export function parseBlueApronRecipe(html, url) {
  const text = String(html || "");
  if (!text || /just a moment/i.test(text.slice(0, 800))) return null;
  const direct = recipeFromPayload(text, url);
  if (direct) return direct;
  const decoded = unescapeEmbedded(text);
  const embedded = decoded === text ? null : recipeFromPayload(decoded, url);
  if (embedded) return embedded;
  const ld = jsonLdRecipe(text) || jsonLdRecipe(decoded);
  if (!ld) return null;
  return { ld, url: url || "" };
}

export function blueApronToJsonLd(parsed) {
  if (!parsed) return null;
  if (parsed.ld) return parsed.ld;
  return {
    name: parsed.name,
    recipeIngredient: parsed.ingredients || [],
    recipeInstructions: parsed.steps || [],
    description: "",
  };
}

function looksLikeRecipe(html) {
  const text = String(html || "");
  if (!text || text.length < 1500) return false;
  if (/just a moment|cf-browser-verification|cf-challenge/i.test(text.slice(0, 1200))) return false;
  return /preparation_steps|recipeIngredient|application\/ld\+json/i.test(text);
}

async function readHtml(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: HTML_HEADERS,
    redirect: "follow",
    cache: "no-store",
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(18000) : undefined,
  });
  if (!res || !res.ok) return "";
  return res.text();
}

async function loadRecipeHtml(target, fetchImpl) {
  let html = "";
  let blocked = false;
  try {
    html = await readHtml(target.url, fetchImpl);
  } catch (_) {
    html = "";
  }
  if (!looksLikeRecipe(html)) {
    blocked = !html || /just a moment|cf-challenge/i.test(html.slice(0, 1200)) || html.length < 1500;
    html = "";
    if (target.timestamp) {
      const archived = `https://web.archive.org/web/${target.timestamp}id_/${target.url}`;
      try {
        const alt = await readHtml(archived, fetchImpl);
        if (looksLikeRecipe(alt)) return { html: alt, blocked: false };
      } catch (_) {}
    }
  }
  return { html, blocked: blocked && !html };
}

function normalizeCdx(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || row[0] === "original") continue;
    const url = String(row[0] || "").split("?")[0];
    const timestamp = String(row[1] || "");
    if (!/\/recipes\/(standard-meal-kit|15-minute-meal-kit|20-minute-meal-kit)\//.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, timestamp });
  }
  return out;
}

export async function loadBlueApronCatalog(fetchImpl = fetch) {
  const now = Date.now();
  if (catalogCache && now - catalogCachedAt < CATALOG_TTL_MS) return catalogCache;
  try {
    const res = await fetchImpl(CDX_URL, {
      headers: { "User-Agent": HTML_HEADERS["User-Agent"], Accept: "application/json" },
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
    if (res && res.ok) {
      const rows = normalizeCdx(await res.json());
      if (rows.length >= 20) {
        catalogCache = rows;
        catalogCachedAt = now;
        return rows;
      }
    }
  } catch (_) {}
  return BA_CATALOG;
}

export function resetBlueApronCatalogCache() {
  catalogCache = null;
  catalogCachedAt = 0;
}

/**
 * Fetch a seeded mix of Blue Apron pages for the requested proteins.
 * Returns { pages: [{ld, url}], error?: string }.
 */
export async function fetchBlueApronPool(fetchImpl = fetch, seed = "", proteins = [], catalog) {
  const list = catalog || await loadBlueApronCatalog(fetchImpl);
  const targets = selectBlueApronTargets(list, proteins, seed, 3);
  const pages = [];
  let blocked = 0;
  let fetched = 0;
  await Promise.all(targets.map(async (target) => {
    const loaded = await loadRecipeHtml(target, fetchImpl);
    if (!loaded.html) {
      if (loaded.blocked) blocked += 1;
      return;
    }
    fetched += 1;
    const parsed = parseBlueApronRecipe(loaded.html, target.url);
    const ld = blueApronToJsonLd(parsed);
    if (!ld) return;
    pages.push({ ld, url: target.url });
  }));
  let error;
  if (!pages.length && targets.length) {
    error = blocked
      ? "recipe pages were blocked and the archive fallback had no readable card"
      : "no readable recipe cards";
  } else if (!pages.length && !targets.length) {
    error = "no recipe URLs for the requested proteins";
  }
  return { pages, error, fetched, blocked };
}

/** @deprecated JSON-LD-only fetch kept for callers that already have URLs. */
export async function fetchBlueApronJsonLd(urls, fetchImpl = fetch) {
  const targets = (urls || []).map((url) => ({ url, timestamp: "" }));
  const pages = [];
  await Promise.all(targets.map(async (target) => {
    const loaded = await loadRecipeHtml(target, fetchImpl);
    if (!loaded.html) return;
    const parsed = parseBlueApronRecipe(loaded.html, target.url);
    const ld = blueApronToJsonLd(parsed);
    if (ld) pages.push({ ld, url: target.url });
  }));
  return pages;
}
