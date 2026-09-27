/**
 * TheMealDB public API (no key): category/search filter, then lookup.
 * Fresh published recipes — not a meal kit.
 */

const API = "https://www.themealdb.com/api/json/v1/1";
const UA = "WeeklyMealPlanner/1.0 (+https://mlenderle.github.io/weekly-meal-plan/)";
const LOOKUP_LIMIT = 8;

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error("TheMealDB HTTP " + res.status);
  return res.json();
}

async function listIds(protein, fetchImpl) {
  if (protein === "salmon") {
    const data = await getJson(`${API}/search.php?s=salmon`, fetchImpl);
    return (data.meals || []).slice(0, LOOKUP_LIMIT).map((m) => m.idMeal);
  }
  const category = protein === "beef" ? "Beef" : protein === "chicken" ? "Chicken" : "Vegetarian";
  const data = await getJson(`${API}/filter.php?c=${encodeURIComponent(category)}`, fetchImpl);
  const meals = data.meals || [];
  if (!meals.length) return [];
  const day = Math.floor(Date.now() / 86400000);
  const start = day % meals.length;
  const ids = [];
  for (let i = 0; i < Math.min(LOOKUP_LIMIT, meals.length); i++) {
    ids.push(meals[(start + i) % meals.length].idMeal);
  }
  return ids;
}

function ingredientLines(meal) {
  const lines = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(meal["strIngredient" + i] || "").trim();
    const measure = String(meal["strMeasure" + i] || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    lines.push(measure ? `${measure} ${name}` : name);
  }
  return lines;
}

function stepLines(instructions) {
  return String(instructions || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1);
}

function avoidTags(ingredients, protein) {
  const blob = ingredients.join(" ").toLowerCase();
  const tags = [];
  if (protein === "beef") tags.push("beef");
  if (protein === "chicken") tags.push("chicken");
  if (protein === "salmon") tags.push("fish", "salmon");
  if (/milk|cheese|butter|cream|yogurt|feta|parmesan/.test(blob)) tags.push("dairy");
  if (/peanut|almond|pecan|walnut|cashew|\bnut\b/.test(blob)) tags.push("nuts");
  if (/soy sauce|tofu|edamame|\bsoy\b/.test(blob)) tags.push("soy");
  if (/flour|pasta|noodle|bread|tortilla|wheat/.test(blob)) tags.push("gluten");
  if (/chili|chilli|cayenne|spicy|hot sauce/.test(blob)) tags.push("spicy");
  if (/mushroom/.test(blob)) tags.push("mushrooms");
  if (/sesame/.test(blob)) tags.push("sesame");
  if (/\begg/.test(blob)) tags.push("egg");
  if (/mustard/.test(blob)) tags.push("mustard");
  if (/shrimp|prawn|crab|lobster/.test(blob)) tags.push("shellfish");
  return tags;
}

export function normalizeTheMealDbMeal(meal, protein) {
  if (!meal || !meal.idMeal || !meal.strMeal) return null;
  const name = String(meal.strMeal).trim();
  const ingredients = ingredientLines(meal);
  const steps = stepLines(meal.strInstructions);
  if (ingredients.length < 3 || steps.length < 2) return null;
  const blob = `${name} ${ingredients.join(" ")}`;
  if (protein === "salmon" && !/\bsalmon\b/i.test(blob)) return null;
  if (protein === "vegetarian" && /\b(beef|chicken|pork|salmon|shrimp|bacon|lamb|fish)\b/i.test(blob)) {
    return null;
  }
  const rich = /fried|cream|cheese|butter|bacon|sausage/.test(name);
  const lean = /salad|grilled|baked|steamed|bowl|herb|roast/.test(name);
  return {
    id: `tmdb-${meal.idMeal}-${slugify(name)}`,
    name,
    shortName: name.length > 42 ? name.slice(0, 40).trim() + "…" : name,
    source: "TheMealDB",
    url: meal.strSource || `https://www.themealdb.com/meal/${meal.idMeal}`,
    protein,
    time: "~30 min",
    pitch: steps[0].slice(0, 220),
    ingredients,
    steps,
    servings: 2,
    spiceLevel: /chili|chilli|cayenne|spicy|hot/.test(blob) ? "Medium–Hot" : "Mild",
    difficulty: "Easy",
    utensils: [],
    healthy: lean && !rich,
    avoidTags: avoidTags(ingredients, protein),
    live: true,
    fetchedFrom: "themealdb-api",
  };
}

export async function fetchTheMealDbPool(proteinsNeeded, fetchImpl = fetch) {
  const out = [];
  await Promise.all(
    (proteinsNeeded || []).map(async (protein) => {
      try {
        const ids = await listIds(protein, fetchImpl);
        const meals = await Promise.all(
          ids.map(async (id) => {
            const data = await getJson(`${API}/lookup.php?i=${encodeURIComponent(id)}`, fetchImpl);
            return data.meals && data.meals[0];
          })
        );
        for (const meal of meals) {
          const norm = normalizeTheMealDbMeal(meal, protein);
          if (norm) out.push(norm);
        }
      } catch (_) {}
    })
  );
  return out;
}
