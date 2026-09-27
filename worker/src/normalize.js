import { paraphraseSteps } from "./paraphrase.js";

const ALLERGEN_MAP = {
  milk: "dairy",
  dairy: "dairy",
  egg: "egg",
  eggs: "egg",
  wheat: "gluten",
  gluten: "gluten",
  soy: "soy",
  soya: "soy",
  sesame: "sesame",
  peanut: "nuts",
  peanuts: "nuts",
  "tree nuts": "nuts",
  "tree-nuts": "nuts",
  treenuts: "nuts",
  fish: "fish",
  shellfish: "shellfish",
  crustacean: "shellfish",
  mustard: "mustard",
};

const HEALTHY_TAG_SLUGS = new Set([
  "calorie-smart",
  "carb-conscious",
  "protein-smart",
  "veggie-packed",
  "sodium-smart",
  "low-sodium",
  "mediterranean",
  "diabetes-friendly",
  "balanced",
  "quick",
  "easy-prep",
]);

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function parseIsoDuration(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const mins = (parseInt(m[1] || "0", 10) * 60) + parseInt(m[2] || "0", 10);
  return mins || null;
}

function formatTime(mins) {
  if (!mins) return "~30 min";
  if (mins <= 20) return `~${mins} min`;
  if (mins <= 45) return `~${mins} min`;
  return `~${mins} min`;
}

function difficultyLabel(d) {
  if (d === 1 || d === "1") return "Easy";
  if (d === 2 || d === "2") return "Medium";
  if (d === 3 || d === "3") return "Hard";
  return "Easy";
}

function spiceFromTags(tags, name) {
  const blob = [...(tags || []).map((t) => t.slug || t.name || ""), name || ""].join(" ").toLowerCase();
  if (/spicy|chili|cayenne|buffalo|cajun|gochujang|hot/.test(blob)) return "Medium–Hot";
  if (/mild/.test(blob)) return "Mild";
  return "Mild–Medium";
}

function detectProtein(item) {
  const cat = (item.category?.type || item.category?.slug || item.category?.name || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  const tags = (item.tags || []).map((t) => (t.slug || t.type || t.name || "").toLowerCase());
  const ing = (item.ingredients || []).map((i) => (i.name || "").toLowerCase()).join(" ");
  const blob = `${cat} ${name} ${tags.join(" ")} ${ing}`;

  const hasAnimal = /\b(chicken|beef|steak|pork|salmon|shrimp|bacon|sausage|turkey|barramundi|cod|tilapia|tuna|lamb|duck|fish|seafood|prawn|anchovy)\b/.test(
    blob
  );

  // Meat / fish first (name+ingredients win over a stray "veggie" side tag)
  if (/\bsalmon\b/.test(blob)) return "salmon";
  if (/\b(chicken|poultry)\b/.test(blob) || cat.includes("poultry")) return "chicken";
  if (
    /\b(beef|steak|sirloin|bavette|tenderloin)\b/.test(blob) ||
    (cat.includes("meat") && /\bbeef\b/.test(blob))
  ) {
    return "beef";
  }
  if (cat.includes("seafood") || /\b(fish|shrimp|cod|tilapia|tuna|barramundi)\b/.test(blob)) {
    // Non-salmon seafood is out of scope for this planner
    return null;
  }

  if (
    tags.includes("vegan") ||
    tags.includes("vegetarian") ||
    cat.includes("veg") ||
    /\b(tofu|chickpea|halloumi|lentil|black bean|veggie|vegetarian)\b/.test(name)
  ) {
    if (!hasAnimal) return "vegetarian";
  }
  return null;
}

function isHealthy(item, calories) {
  const tags = (item.tags || []).map((t) => (t.slug || t.type || "").toLowerCase());
  if (tags.some((t) => HEALTHY_TAG_SLUGS.has(t))) return true;
  const label = (item.label?.handle || item.label?.text || "").toLowerCase();
  if (/calorie|carb|protein smart|veggie|sodium/.test(label)) return true;
  if (calories && calories <= 650) return true;
  // Salad / bowl / sheet-pan lean dinners
  const name = (item.name || "").toLowerCase();
  if (/(salad|bowl|sheet.?pan|roasted|herb)/.test(name) && calories && calories <= 750) return true;
  return false;
}

function avoidTagsFor(item, protein) {
  const tags = new Set();
  for (const a of item.allergens || []) {
    const key = ALLERGEN_MAP[(a.type || a.slug || a.name || "").toLowerCase()];
    if (key) tags.add(key);
  }
  const blob = [
    item.name,
    ...(item.ingredients || []).map((i) => i.name),
    ...(item.tags || []).map((t) => t.name),
  ]
    .join(" ")
    .toLowerCase();
  if (/mushroom/.test(blob)) tags.add("mushrooms");
  if (/spicy|chili|cayenne|buffalo|cajun|hot sauce|gochujang/.test(blob)) tags.add("spicy");
  if (/sesame/.test(blob)) tags.add("sesame");
  if (/mustard|dijon/.test(blob)) tags.add("mustard");
  if (protein === "salmon") tags.add("fish");
  if (protein && protein !== "vegetarian") tags.add(protein);
  return [...tags];
}

function formatAmount(amount, unit) {
  if (amount == null || amount === "") return "";
  let a = amount;
  if (typeof a === "number") {
    if (Math.abs(a - 0.5) < 0.01) a = "½";
    else if (Math.abs(a - 0.25) < 0.01) a = "¼";
    else if (Math.abs(a - 0.75) < 0.01) a = "¾";
    else if (Number.isInteger(a)) a = String(a);
    else a = String(Math.round(a * 100) / 100);
  }
  const u = (unit || "").toLowerCase();
  const unitOut =
    u === "ounce" || u === "ounces" ? "oz" :
    u === "tablespoon" || u === "tablespoons" ? "Tbsp" :
    u === "teaspoon" || u === "teaspoons" ? "tsp" :
    u === "unit" || u === "units" ? "" :
    u === "clove" || u === "cloves" ? "clove" :
    unit || "";
  return `${a}${unitOut ? " " + unitOut : ""}`.trim();
}

function buildIngredientLines(item) {
  const byId = Object.fromEntries((item.ingredients || []).map((i) => [i.id, i]));
  const yield2 = (item.yields || []).find((y) => y.yields === 2) || (item.yields || [])[0];
  if (yield2 && yield2.ingredients) {
    return yield2.ingredients.map((yi) => {
      const meta = byId[yi.id] || {};
      const amt = formatAmount(yi.amount, yi.unit);
      const name = meta.name || "Ingredient";
      return amt ? `${amt} ${name}` : name;
    });
  }
  return (item.ingredients || []).map((i) => i.name).filter(Boolean);
}

function extractSteps(item) {
  const raw = (item.steps || []).map((s) => s.instructions || s.text || "").filter(Boolean);
  return paraphraseSteps(raw);
}

function caloriesOf(item) {
  const n = item.nutrition;
  if (Array.isArray(n)) {
    const c = n.find((x) => /calorie/i.test(x.name || ""));
    return c ? Number(c.amount) : null;
  }
  if (n && typeof n === "object") {
    const c = n.calories || n.calorie;
    if (typeof c === "number") return c;
    if (typeof c === "string") return parseInt(c, 10) || null;
  }
  return null;
}

export function normalizeHelloFreshItem(item) {
  const protein = detectProtein(item);
  if (!protein) return null;
  // Skip variety packs / add-ons without real steps
  const steps = extractSteps(item);
  if (steps.length < 2) return null;
  const name = item.name || "Dinner";
  if (/variety pack|breakfast|addon|add-on|side only/i.test(name)) return null;

  const calories = caloriesOf(item);
  const totalMins = parseIsoDuration(item.totalTime) || parseIsoDuration(item.prepTime);
  const id = slugify(item.slug || name) || item.id;
  const ingredients = buildIngredientLines(item);
  if (ingredients.length < 3) return null;

  const healthy = isHealthy(item, calories);
  const shortName = name.length > 42 ? name.slice(0, 40).trim() + "…" : name;
  const pitch = (item.description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  return {
    id,
    name,
    shortName,
    source: "HelloFresh",
    url: item.websiteUrl || `https://www.hellofresh.com/recipes/${item.slug}-${item.id}`,
    protein,
    time: formatTime(totalMins),
    pitch: pitch || `${protein} dinner kit card with full steps.`,
    ingredients,
    steps,
    servings: 2,
    calories: calories || undefined,
    spiceLevel: spiceFromTags(item.tags, name),
    difficulty: difficultyLabel(item.difficulty),
    utensils: (item.utensils || []).map((u) => u.name).filter(Boolean),
    healthy,
    avoidTags: avoidTagsFor(item, protein),
    live: true,
    fetchedFrom: "hellofresh-api",
  };
}

export function normalizeJsonLdRecipe(ld, sourceLabel, url) {
  const name = ld.name || "Dinner";
  const ingredients = ld.recipeIngredient || [];
  let steps = [];
  const inst = ld.recipeInstructions;
  if (Array.isArray(inst)) {
    steps = inst.map((s) => (typeof s === "string" ? s : s.text || "")).filter(Boolean);
  } else if (typeof inst === "string") {
    steps = [inst];
  }
  steps = paraphraseSteps(steps);
  if (ingredients.length < 3 || steps.length < 2) return null;

  const fakeItem = {
    name,
    description: ld.description || "",
    ingredients: ingredients.map((n) => ({ name: n })),
    tags: [],
    allergens: [],
    category: {},
  };
  // protein from name/ingredients
  const protein = detectProtein({
    name,
    ingredients: ingredients.map((n) => ({ name: n })),
    tags: /\bvegetarian|vegan|tofu|chickpea|halloumi|lentil\b/i.test(name + ingredients.join(" "))
      ? [{ slug: "vegetarian" }]
      : [],
    category: { name: "" },
  });
  if (!protein) return null;

  let calories = null;
  const nut = ld.nutrition;
  if (nut && nut.calories) {
    calories = parseInt(String(nut.calories), 10) || null;
  }
  const mins = parseIsoDuration(ld.totalTime) || parseIsoDuration(ld.cookTime);
  const id = slugify(name) + "-" + slugify(sourceLabel);

  return {
    id,
    name,
    shortName: name.length > 42 ? name.slice(0, 40).trim() + "…" : name,
    source: sourceLabel,
    url: url || ld['@id'] || ld.url || "",
    protein,
    time: formatTime(mins),
    pitch: (ld.description || "").replace(/\s+/g, " ").trim().slice(0, 220),
    ingredients,
    steps,
    servings: parseInt(ld.recipeYield, 10) || 2,
    calories: calories || undefined,
    spiceLevel: spiceFromTags([], name),
    difficulty: "Easy",
    utensils: [],
    healthy: isHealthy({ name, tags: [], label: {} }, calories),
    avoidTags: avoidTagsFor(
      {
        name,
        ingredients: ingredients.map((n) => ({ name: n })),
        allergens: [],
        tags: [],
      },
      protein
    ),
    live: true,
    fetchedFrom: "json-ld",
  };
}

export function recipeHitsAvoid(m, avoidSet, customAvoid) {
  const tags = (m.avoidTags || []).map((t) => t.toLowerCase());
  for (const a of avoidSet) {
    if (tags.includes(a)) return true;
  }
  const blob = [...(m.ingredients || []), m.name || "", m.pitch || "", ...(m.avoidTags || [])]
    .join(" ")
    .toLowerCase();
  for (const c of customAvoid || []) {
    if (c && blob.includes(String(c).toLowerCase())) return true;
  }
  return false;
}
