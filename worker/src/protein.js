/**
 * Keep a recipe's protein slot, title, ingredients, and steps on the same protein.
 *
 * HelloFresh often ships one protein in the title and ingredient list while the
 * step text is still the chicken/pork template ("Pat chicken* dry…") plus an
 * optional "Swap in salmon*" aside. Those cards were printing a salmon title
 * with chicken instructions.
 */

const SLOT_PROTEINS = new Set(["beef", "chicken", "salmon", "vegetarian"]);

const FAMILY = {
  salmon: ["salmon"],
  chicken: ["chicken"],
  beef: ["beef", "steak", "sirloin", "bavette", "brisket", "tenderloin", "flank", "ribeye"],
};

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

function shippedNoun(meal) {
  if (meal.protein === "salmon") return "salmon";
  if (meal.protein === "chicken") return "chicken";
  if (meal.protein === "beef") {
    const blob = `${meal.name || ""} ${(meal.ingredients || []).map(ingredientName).join(" ")}`;
    if (/\b(steak|sirloin|bavette|brisket|tenderloin|flank|ribeye)\b/i.test(blob)) return "steak";
    return "beef";
  }
  return "";
}

function inFamily(word, protein) {
  const family = FAMILY[protein] || [];
  return family.includes(String(word || "").toLowerCase());
}

function replaceAliens(text, protein, noun) {
  if (!noun) return text;
  const aliens = ["tenderloin", "sirloin", "bavette", "brisket", "ribeye", "flank", "chicken", "salmon", "steak", "pork", "beef"];
  let out = text;
  for (const word of aliens) {
    if (inFamily(word, protein)) continue;
    const re = new RegExp("\\b" + word + "s?\\b\\*?", "gi");
    out = out.replace(re, (full, offset, str) => {
      const before = str.slice(Math.max(0, offset - 20), offset);
      if (/(cauliflower|eggplant|portobello|mushroom|veggie|vegetable)\s+$/i.test(before)) return full;
      const after = str.slice(offset + full.length, offset + full.length + 28);
      if (/^\s*(stock|broth|bouillon|base|consomme|powder|seasoning|spice|rub|blend)\b/i.test(after)) return full;
      return noun;
    });
  }
  return out
    .replace(/\b(salmon|chicken|steak|beef)\b(?:\s+or\s+\1\b)+/gi, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

function wantedRe(protein) {
  if (protein === "beef") return /\b(beef|steak)\b/i;
  if (protein === "salmon") return /\bsalmon\b/i;
  if (protein === "chicken") return /\bchicken\b/i;
  return null;
}

/** Prefer the "Swap in <our protein>" branch when HelloFresh left both methods in one step. */
function preferSwap(step, protein, noun) {
  const re = /swap in\s+(.+?)\s+for\s+[a-z]+(?:\*)?(?:\s*\([^)]*\))?\s*[.;:]?\s*/i;
  const match = step.match(re);
  if (!match) return null;
  const wanted = wantedRe(protein);
  const offers = match[1].replace(/\*/g, "");
  const head = step.slice(0, match.index).trim();
  let rest = step.slice(match.index + match[0].length).trim();
  if (!wanted || !wanted.test(offers)) {
    return replaceAliens(head || step, protein, noun);
  }
  const parts = rest.split(/\s+or\s+/i);
  if (parts.length > 1) {
    const hit = parts.find((part) => wanted.test(part));
    if (hit) rest = hit.trim();
  }
  if (!rest) return replaceAliens(step, protein, noun);
  return replaceAliens(rest, protein, noun);
}

export function alignSteps(steps, meal) {
  const protein = meal && meal.protein;
  const noun = shippedNoun(meal || {});
  return (steps || []).map((step) => {
    let text = String(step || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    if (!text || protein === "vegetarian" || !noun) return text;
    const swapped = preferSwap(text, protein, noun);
    text = swapped == null ? replaceAliens(text, protein, noun) : swapped;
    if (protein === "salmon") {
      // Pounding is the chicken-cutlet template. HelloFresh's own swap note says not to pound salmon.
      text = text.replace(/(?:^|\.\s+)[^.]*\bpound\b[^.]*(?=\.|$)/gi, "");
    }
    return text.replace(/\*+/g, "").replace(/[ \t]{2,}/g, " ").replace(/\s+\./g, ".").trim();
  }).filter(Boolean);
}

function stepBlob(steps) {
  return stripFalseCuts((steps || []).join(" \n "));
}

function stepsHaveAlien(steps, protein) {
  const text = stepBlob(steps)
    .replace(/\b(chicken|beef|fish)\s+(stock|broth|bouillon|base|consomme)\b/gi, " ")
    .replace(/\b(steak|chicken|beef|salmon)\s+(spice|seasoning|powder|rub|blend)\b/gi, " ");
  if (/\bpork\b/i.test(text)) return true;
  const checks = [
    ["salmon", /\bsalmon\b/i],
    ["chicken", /\bchicken\b/i],
    ["beef", /\b(beef|steak|sirloin|bavette|brisket|tenderloin)\b/i],
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
    return issues;
  }
  if (nameHits.some((id) => id !== protein)) issues.push("title");
  if (ingHits.length !== 1 || ingHits[0] !== protein) issues.push("ingredients");
  if (stepsHaveAlien(meal.steps, protein)) issues.push("steps");
  const inferred = inferProtein({
    name: meal.name,
    ingredients: meal.ingredients,
    tags: meal.protein === "vegetarian" ? ["vegetarian"] : [],
  });
  if (inferred && inferred !== protein) issues.push("inferred");
  return issues;
}

/** Return a copy whose steps follow the shipped protein, or null if it still disagrees. */
export function alignMeal(meal) {
  if (!meal || typeof meal !== "object") return null;
  if (!SLOT_PROTEINS.has(meal.protein)) return null;
  const steps = alignSteps(meal.steps, meal);
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
