/**
 * Live Blue Apron enrichment: fetch public recipe pages and parse JSON-LD.
 * Seed URLs are discovery only — ingredients/steps always come from the live page.
 */

export const BA_SEED_URLS = [
  "https://www.blueapron.com/recipes/standard-meal-kit/sheet-pan-cajun-salmon-with-asparagus-sweet-potato-spiced-sour-cream",
  "https://www.blueapron.com/recipes/seared-steaks-chimichurri-sauce",
  "https://www.blueapron.com/recipes/spanish-spiced-chicken-rice",
  "https://www.blueapron.com/recipes/sheet-pan-soy-glazed-salmon",
  "https://www.blueapron.com/recipes/crispy-chickpea-grain-bowls",
  "https://www.blueapron.com/recipes/mushroom-quesadillas",
  "https://www.blueapron.com/recipes/seared-steaks-roasted-broccoli",
  "https://www.blueapron.com/recipes/panko-crusted-cod",
  "https://www.blueapron.com/recipes/italian-wedding-soup",
  "https://www.blueapron.com/recipes/vegetable-fried-rice",
  "https://www.blueapron.com/recipes/honey-ginger-glazed-salmon",
  "https://www.blueapron.com/recipes/chipotle-chicken-burritos",
];

function pickSeeds(count) {
  // Rotate by day so live results vary without a fixed catalog.
  const day = Math.floor(Date.now() / 86400000);
  const start = day % BA_SEED_URLS.length;
  const out = [];
  for (let i = 0; i < Math.min(count, BA_SEED_URLS.length); i++) {
    out.push(BA_SEED_URLS[(start + i) % BA_SEED_URLS.length]);
  }
  return out;
}

export async function fetchBlueApronJsonLd(urls, fetchImpl = fetch) {
  const results = [];
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetchImpl(url, {
          headers: {
            "User-Agent": "WeeklyMealPlanner/1.0 (+https://mlenderle.github.io/weekly-meal-plan/)",
            Accept: "text/html",
          },
          redirect: "follow",
        });
        if (!res.ok) return;
        const html = await res.text();
        const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis)];
        for (const b of blocks) {
          try {
            const data = JSON.parse(b[1]);
            const nodes = Array.isArray(data) ? data : [data];
            for (const n of nodes) {
              if (n && (n["@type"] === "Recipe" || (Array.isArray(n["@type"]) && n["@type"].includes("Recipe")))) {
                results.push({ ld: n, url: res.url || url });
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    })
  );
  return results;
}

export async function fetchBlueApronPool(fetchImpl = fetch) {
  return fetchBlueApronJsonLd(pickSeeds(8), fetchImpl);
}
