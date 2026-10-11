/**
 * Keep a recipe's protein slot, title, ingredients, and steps on the same protein.
 *
 * HelloFresh often ships one protein in the title and ingredient list while the
 * step text is still the chicken/pork template ("Pat chicken* dry…") plus an
 * optional "Swap in salmon*" aside. Those cards were printing a salmon title
 * with chicken instructions.
 */

const SLOT_PROTEINS = new Set(["beef", "chicken", "salmon", "vegetarian"]);

const NAME_RE = {
  salmon: /\bsalmon\b/i,
  chicken: /\bchicken\b/i,
  beef: /\b(beef|steak|sirloin|bavette|brisket|tenderloin|flank|ribeye)\b/i,
};

const ING_RE = {
  salmon: /\bsalmon\b/i,
  chicken: /\bchicken\b/i,
  beef: /\b(ground beef|sirloin|bavette|brisket|tenderloin|flank|ribeye|skirt steak|ranch steak|beef|steak)\b/i,
};

function ingredientName(item) {
  if (typeof item === "string") return item;
  return (item && item.name) || "";
}

function stripFalseCuts(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\b(cauliflower|eggplant|portobello|mushroom|veggie|vegetable)\s+steaks?\b/gi, " ")
    .replace(/\bbeefsteak\s+tomatoes?\b/gi, " tomato ");
}

/** Drop broth and spice blends so "chicken stock" is not the recipe protein. */
function realIngredientBlob(ingredients) {
  const names = (ingredients || []).map(ingredientName).filter(Boolean);
  return stripFalseCuts(
    names
      .filter((name) => !/\b(stock|broth|bouillon|base|consomme)\b/i.test(name))
      .filter((name) => !/\b(seasoning|spice|powder|rub|blend)\b/i.test(name))
      .join(" \n ")
  );
}

function rawBlob(ingredients) {
  return stripFalseCuts((ingredients || []).map(ingredientName).filter(Boolean).join(" \n "));
}

function hits(text, map) {
  const found = [];
  for (const id of ["salmon", "chicken", "beef"]) {
    if (map[id].test(text)) found.push(id);
  }
  return found;
}

function vegHint(name, tags, category) {
  const blob = [name, category, ...(tags || []).map((t) => (typeof t === "string" ? t : t.slug || t.type || t.name || ""))]
    .join(" ")
    .toLowerCase();
  return /vegetarian|vegan|veggie|tofu|chickpea|lentil|halloumi|cauliflower|black bean|mushroom|quinoa|falafel/.test(blob);
}

function hasUnwantedAnimal(text) {
  return /\b(chicken|salmon|beef|steak|sirloin|bavette|brisket|tenderloin|pork|bacon|sausage|shrimp|prawn|turkey|lamb|fish|tuna|cod|tilapia|anchovy)\b/i.test(
    stripFalseCuts(text)
  );
}

/**
 * Protein implied by the title and the real protein ingredient.
 * Returns null when the title and the ingredient list name two different proteins.
 */
export function inferProtein({ name, ingredients, tags, category } = {}) {
  const cleanedName = stripFalseCuts(name);
  const ing = realIngredientBlob(ingredients);
  const nameHits = hits(cleanedName, NAME_RE);
  const ingHits = hits(ing, ING_RE);
  if (nameHits.length > 1 || ingHits.length > 1) return null;
  const nameHit = nameHits[0] || null;
  const ingHit = ingHits[0] || null;
  if (nameHit && ingHit && nameHit !== ingHit) return null;
  if (nameHit) return nameHit;
  if (ingHit) return ingHit;
  if (!hasUnwantedAnimal(cleanedName) && !hasUnwantedAnimal(ing) && !hasUnwantedAnimal(rawBlob(ingredients))) {
    if (vegHint(cleanedName, tags, category)) return "vegetarian";
  }
  return null;
}

/** Sides and other foods a step should not invent. Pantry staples are intentionally absent. */
const KEY_FOODS = [
  "sweet potato", "green bean", "snap pea", "bell pepper",
  "potato", "carrot", "broccoli", "zucchini", "kale", "spinach", "rice", "pasta", "noodle",
  "bulgur", "quinoa", "couscous", "tortilla", "chickpea", "lentil", "tofu", "mushroom",
  "tomato", "onion", "shallot", "garlic", "lemon", "lime", "cucumber", "asparagus",
  "avocado", "cauliflower", "eggplant", "cabbage", "radish", "apple", "corn", "gnocchi",
  "polenta", "farro", "orzo", "edamame", "halloumi", "feta", "cheddar", "parmesan",
  "mozzarella", "peanut", "almond", "walnut", "bun", "barley", "artichoke", "caper", "date",
  "cilantro", "jalapeno", "jalapeño",
];

function foodIn(blob, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + escaped + "(?:es|s)?\\b", "i").test(blob);
}

/** Foods named in the steps that the ingredient list does not contain. */
export function missingKeyFoods(meal) {
  const ing = `${meal && meal.name ? meal.name : ""} ${(meal && meal.ingredients ? meal.ingredients : []).map(ingredientName).join(" ")}`;
  const steps = stepBlob(meal && meal.steps);
  const missing = [];
  const foods = KEY_FOODS.slice().sort((a, b) => b.length - a.length);
  for (const food of foods) {
    if (!foodIn(steps, food)) continue;
    if (foodIn(ing, food)) continue;
    if (food === "potato" && foodIn(ing, "sweet potato")) continue;
    if (food === "bean" && foodIn(ing, "green bean")) continue;
    missing.push(food);
  }
  return missing;
}

/** Whitespace and markup only. Protein words are not rewritten; mismatches are dropped. */
export function alignSteps(steps) {
  return (steps || []).map((step) => String(step || "")
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\*+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\./g, ".")
    .trim()
  ).filter(Boolean);
}

function stepBlob(steps) {
  return stripFalseCuts((steps || []).join(" \n "))
    .replace(/consuming raw or undercooked\b[\s\S]*$/i, " ");
}

function stepsHaveAlien(steps, protein) {
  const text = stepBlob(steps)
    .replace(/\b(chicken|beef|fish)\s+(stock|broth|bouillon|base|consomme)\b/gi, " ")
    .replace(/\b(steak|chicken|beef|salmon)\s+(spice|seasoning|powder|rub|blend)\b/gi, " ");
  if (/\bpork\b/i.test(text)) return true;
  const checks = [
    ["salmon", /\bsalmon\b/i],
    ["chicken", /\bchicken\b/i],
    ["beef", /\b(beef|steak|sirloin|bavette|brisket|tenderloin|flank|rib-?eye)\b/i],
  ];
  for (const [id, re] of checks) {
    if (id === protein) continue;
    if (re.test(text)) return true;
  }
  return false;
}

export function recipeIssues(meal) {
  const issues = [];
  if (!meal || !SLOT_PROTEINS.has(meal.protein)) {
    issues.push("protein");
    return issues;
  }
  const protein = meal.protein;
  const name = stripFalseCuts(meal.name || "");
  const ing = realIngredientBlob(meal.ingredients);
  const nameHits = hits(name, NAME_RE);
  const ingHits = hits(ing, ING_RE);
  if (protein === "vegetarian") {
    const stepText = (meal.steps || []).join(" \n ")
      .replace(/\b(chicken|beef|fish)\s+(stock|broth|bouillon|base|consomme)\b/gi, " ");
    if (hasUnwantedAnimal(name) || hasUnwantedAnimal(rawBlob(meal.ingredients)) || hasUnwantedAnimal(stepText)) {
      issues.push("vegetarian-animal");
    }
    if (missingKeyFoods(meal).length) issues.push("step-ingredients");
    return issues;
  }
  if (nameHits.some((id) => id !== protein)) issues.push("title");
  if (ingHits.length !== 1 || ingHits[0] !== protein) issues.push("ingredients");
  if (stepsHaveAlien(meal.steps, protein)) issues.push("steps");
  if (missingKeyFoods(meal).length) issues.push("step-ingredients");
  const inferred = inferProtein({
    name: meal.name,
    ingredients: meal.ingredients,
    tags: meal.protein === "vegetarian" ? ["vegetarian"] : [],
  });
  if (inferred && inferred !== protein) issues.push("inferred");
  return issues;
}

/**
 * Return the meal when title, ingredients, and steps already agree.
 * Template steps that name another protein or a food that was not shipped are dropped.
 */
export function alignMeal(meal) {
  if (!meal || typeof meal !== "object") return null;
  if (!SLOT_PROTEINS.has(meal.protein)) return null;
  const steps = alignSteps(meal.steps);
  const next = { ...meal, steps };
  if ((next.steps || []).length < 2) return null;
  if (recipeIssues(next).length) return null;
  return next;
}

export function recipeFitsSlot(meal, slotProtein) {
  if (!meal || meal.protein !== slotProtein) return false;
  if (!SLOT_PROTEINS.has(slotProtein)) return false;
  return recipeIssues(meal).length === 0;
}

if (typeof globalThis !== "undefined" && globalThis.window) {
  globalThis.window.MealProtein = { alignMeal, alignSteps, recipeIssues, recipeFitsSlot, inferProtein };
}
