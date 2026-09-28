#!/usr/bin/env node
/**
 * Regression: a protein slot cannot carry another protein's ingredients or steps,
 * and repeated plans are not stuck on one recipe when the catalog has options.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alignMeal, inferProtein, recipeFitsSlot, recipeIssues } from "../worker/src/protein.js";
import { normalizeHelloFreshItem } from "../worker/src/normalize.js";
import { buildPlanFromCandidates } from "../worker/src/plan.js";
import { helloFreshSearchPlan } from "../worker/src/hf.js";
import { blueApronSeedPlan } from "../worker/src/ba.js";
import { sanitizeMatchPrefs } from "../worker/src/index.js";

function meal(partial) {
  return {
    id: partial.id || "r1",
    name: partial.name,
    protein: partial.protein,
    ingredients: partial.ingredients,
    steps: partial.steps,
    healthy: true,
    cheapScore: partial.cheapScore ?? 50,
    avoidTags: [],
  };
}

const garlicHerb = meal({
  name: "Garlic Herb Salmon",
  protein: "salmon",
  ingredients: ["10 oz Salmon", "1 Lemon", "1/4 oz Parsley", "1 tsp Garlic Powder"],
  steps: [
    "Rinse and dry the produce.",
    "Pat chicken* dry with paper towels. Season all over with garlic powder, salt, and pepper. Cook chicken until browned, 3-5 minutes per side.",
    "Slice chicken crosswise. Divide salad and chicken between plates.",
  ],
});

const alignedSalmon = alignMeal(garlicHerb);
assert.ok(alignedSalmon, "salmon card with chicken template steps should be rewritten, not dropped");
assert.equal(alignedSalmon.protein, "salmon");
assert.match(alignedSalmon.ingredients.join(" "), /Salmon/);
assert.doesNotMatch(alignedSalmon.steps.join(" "), /\bchicken\b/i);
assert.match(alignedSalmon.steps.join(" "), /\bsalmon\b/i);
const pounded = alignMeal(meal({
  name: "Blue Plate Special Salmon Dinner Bar",
  protein: "salmon",
  ingredients: ["10 oz Salmon", "2 Chicken Stock Concentrate", "12 oz Potatoes", "1 tbsp Butter"],
  steps: [
    "Heat the oven to 425 degrees. Dice the potatoes.",
    "Pat chicken* dry with paper towels. Pound with a mallet until chicken is about 1/2 inch thick. Season with salt. Cook chicken 5-7 minutes per side.",
    "Slice chicken and serve with the potatoes.",
  ],
}));
assert.ok(pounded);
assert.doesNotMatch(pounded.steps.join(" "), /\b(chicken|pound)\b/i);
assert.match(pounded.steps.join(" "), /Cook salmon 5-7 minutes per side/i);
assert.match(pounded.ingredients.join(" "), /Chicken Stock Concentrate/);

assert.equal(recipeFitsSlot(alignedSalmon, "salmon"), true);
assert.equal(recipeFitsSlot(alignedSalmon, "chicken"), false);
assert.deepEqual(recipeIssues(alignedSalmon), []);

const herbed = alignMeal(meal({
  name: "Herbed Salmon over Apple & Kale Salad",
  protein: "salmon",
  ingredients: ["4 oz Kale", "10 oz Salmon", "1 Apple", "1 tsp Garlic Powder"],
  steps: [
    "Rinse and dry the produce. Chop the kale.",
    "Pat chicken* dry with paper towels. Pound until chicken is about 1/2 inch thick. Cook chicken 3-5 minutes per side. Transfer to a cutting board. Swap in salmon* for chicken (no need to pound salmon!). Cook salmon (skin sides down) until skin is crisp, 5-7 minutes. Flip and cook until cooked through, 1-2 minutes more.",
    "Slice chicken crosswise. Top with chicken. Serve salmon (no need to slice!) atop salad.",
  ],
}));
assert.ok(herbed);
const cookStep = herbed.steps[1];
assert.match(cookStep, /Cook salmon \(skin sides down\)/i);
assert.doesNotMatch(cookStep, /3-5 minutes per side/i);
assert.doesNotMatch(herbed.steps.join(" "), /\bchicken\b/i);

const bavette = alignMeal(meal({
  name: "2x Bavette Steak & Creamy Cannellini Beans",
  protein: "beef",
  ingredients: ["10 oz Bavette Steak", "1 Zucchini", "2 Chicken Stock Concentrate", "1 tbsp Butter"],
  steps: [
    "Heat the oven to 450 degrees. Slice the zucchini.",
    "Pat chicken* dry with paper towels. Add chicken; cook until browned and cooked through, 5-7 minutes per side.",
    "Slice chicken crosswise. Top with chicken and spoon the pan sauce over chicken.",
  ],
}));
assert.ok(bavette, "steak + chicken stock must stay beef and not be tagged chicken");
assert.equal(bavette.protein, "beef");
assert.match(bavette.ingredients.join(" "), /Chicken Stock Concentrate/);
assert.match(bavette.ingredients.join(" "), /Bavette Steak/);
assert.doesNotMatch(bavette.steps.join(" "), /\bchicken\b/i);
assert.match(bavette.steps.join(" "), /\bsteak\b/i);
assert.equal(inferProtein({
  name: bavette.name,
  ingredients: bavette.ingredients.map((n) => ({ name: n })),
}), "beef");

const swapBeef = alignMeal(meal({
  name: "Beef Tenderloin with Balsamic Mushroom Sauce",
  protein: "beef",
  ingredients: ["10 oz Beef Tenderloin", "8 oz Mushrooms", "1 tbsp Butter", "1 tsp Thyme"],
  steps: [
    "Heat the oven to 425 degrees. Slice the mushrooms.",
    "Pat pork* dry with paper towels. Swap in chicken or beef for pork; cook chicken until cooked through, 3-5 minutes per side, or cook beef to desired doneness, 4-7 minutes per side.",
    "Slice the beef and serve with the mushrooms.",
  ],
}));
assert.ok(swapBeef);
assert.match(swapBeef.steps[1], /cook beef to desired doneness/i);
assert.doesNotMatch(swapBeef.steps.join(" "), /\b(chicken|pork)\b/i);

assert.equal(alignMeal(meal({
  name: "Garlic Herb Salmon",
  protein: "salmon",
  ingredients: ["12 oz Chicken Cutlets", "1 Lemon", "4 oz Kale", "1 tsp Salt"],
  steps: ["Rinse the produce.", "Cook the chicken until 165°F.", "Slice the chicken and serve."],
})), null);

assert.equal(inferProtein({
  name: "Cauliflower Steak Bowls",
  ingredients: ["1 cauliflower", "1 lemon", "1 cup chickpeas", "2 tbsp tahini"],
  tags: ["vegetarian"],
}), "vegetarian");

assert.equal(alignMeal(meal({
  name: "Cauliflower Steak Bowls",
  protein: "beef",
  ingredients: ["1 cauliflower", "1 lemon", "1 cup chickpeas", "2 tbsp tahini"],
  steps: ["Roast the cauliflower steaks.", "Whisk the tahini.", "Serve the bowls."],
})), null);

const hf = normalizeHelloFreshItem({
  id: "68d65a7ed232ff05cfc495f1",
  slug: "garlic-herb-salmon",
  name: "Garlic Herb Salmon",
  ingredients: [
    { id: "a", name: "Salmon" },
    { id: "b", name: "Lemon" },
    { id: "c", name: "Parsley" },
    { id: "d", name: "Chicken Stock Concentrate" },
  ],
  steps: [
    { instructions: "Wash and dry produce." },
    { instructions: "Pat chicken* dry with paper towels and cook chicken 3-5 minutes per side." },
    { instructions: "Slice chicken and serve." },
  ],
  tags: [{ slug: "protein-smart" }],
  category: { name: "poultry" },
});
assert.ok(hf);
assert.equal(hf.id, "68d65a7ed232ff05cfc495f1");
assert.equal(hf.protein, "salmon");
assert.doesNotMatch(hf.steps.join(" "), /\bchicken\b/i);
assert.match(hf.ingredients.join(" "), /Chicken Stock Concentrate/);
assert.match(hf.ingredients.join(" "), /Salmon/);

const catalog = JSON.parse(readFileSync(new URL("../meal-plan-data.json", import.meta.url), "utf8"));
for (const candidate of Object.values(catalog.candidates)) {
  const fixed = alignMeal(candidate);
  assert.ok(fixed, `offline demo recipe dropped: ${candidate.name} ${recipeIssues(candidate).join(",")}`);
  assert.equal(fixed.protein, candidate.protein, candidate.name);
  assert.equal(recipeFitsSlot(fixed, candidate.protein), true, candidate.name);
}

function salmonPool() {
  const candidates = {};
  for (let i = 0; i < 6; i++) {
    candidates["salmon-" + i] = meal({
      id: "salmon-" + i,
      name: "Salmon Dinner " + i,
      protein: "salmon",
      ingredients: ["10 oz Salmon", "1 Lemon", "4 oz Kale", "1 tsp Salt"],
      steps: ["Rinse the produce.", "Cook the salmon to 145°F.", "Serve the salmon."],
      cheapScore: 80 - i,
    });
  }
  return candidates;
}

const prefs = { beef: 0, chicken: 0, salmon: 1, vegetarian: 0, healthyOnly: false, cheapBias: false };
const seen = new Set();
for (let n = 0; n < 12; n++) {
  const plan = buildPlanFromCandidates(salmonPool(), { ...prefs, seed: "variety-" + n });
  seen.add(plan.slots[0].mealId);
}
assert.ok(seen.size >= 3, "expected several different salmon picks, got " + [...seen].join(","));

const again = buildPlanFromCandidates(salmonPool(), { ...prefs, seed: "variety-3" });
const again2 = buildPlanFromCandidates(salmonPool(), { ...prefs, seed: "variety-3" });
assert.equal(again.slots[0].mealId, again2.slots[0].mealId);

const dupes = {
  "chick-a": meal({
    id: "chick-a",
    name: "Crispy Kickin' Cayenne Chicken Cutlets",
    protein: "chicken",
    ingredients: ["12 oz Chicken Cutlets", "12 oz Potatoes", "4 oz Broccoli", "1 tbsp Butter"],
    steps: ["Heat the oven to 425 degrees.", "Cook the chicken until 165°F.", "Serve the chicken."],
  }),
  "chick-b": meal({
    id: "chick-b",
    name: "Crispy Kickin’ Cayenne Chicken Cutlets",
    protein: "chicken",
    ingredients: ["10 oz Chicken Cutlets", "8 oz Green Beans", "4 oz Broccoli", "1 tbsp Butter"],
    steps: ["Heat the oven to 425 degrees.", "Cook the chicken until 165°F.", "Serve the chicken."],
  }),
  "chick-c": meal({
    id: "chick-c",
    name: "Rosemary Chicken Cutlets",
    protein: "chicken",
    ingredients: ["12 oz Chicken Cutlets", "9 oz Carrots", "1 tsp Rosemary", "1 tbsp Butter"],
    steps: ["Heat the oven to 425 degrees.", "Cook the chicken until 165°F.", "Serve the chicken."],
  }),
};
const dupePlan = buildPlanFromCandidates(dupes, {
  beef: 0, chicken: 2, salmon: 0, vegetarian: 0, healthyOnly: false, seed: "titles",
});
const dupeNames = dupePlan.slots.map((s) => dupes[s.mealId].name.replace(/[’']/g, "'"));
assert.equal(new Set(dupeNames).size, 2, dupeNames.join(" | "));

const excluded = buildPlanFromCandidates(salmonPool(), {
  ...prefs,
  seed: "keep",
  excludeIds: ["salmon-0", "salmon-1", "salmon-2", "salmon-3", "salmon-4"],
});
assert.equal(excluded.slots[0].mealId, "salmon-5");

const band = {};
for (const [id, score] of [["salmon-a", 84], ["salmon-b", 86], ["salmon-c", 40]]) {
  band[id] = meal({
    id,
    name: "Salmon " + id,
    protein: "salmon",
    ingredients: ["10 oz Salmon", "1 Lemon", "4 oz Kale"],
    steps: ["Rinse the produce.", "Cook the salmon.", "Serve the salmon."],
    cheapScore: score,
  });
}
const bandPicks = new Set();
for (let n = 0; n < 20; n++) {
  const plan = buildPlanFromCandidates(band, {
    ...prefs,
    cheapBias: true,
    seed: "cheap-" + n,
  });
  bandPicks.add(plan.slots[0].mealId);
}
assert.equal(bandPicks.has("salmon-c"), false);
assert.ok(bandPicks.has("salmon-a") && bandPicks.has("salmon-b"), [...bandPicks].join(","));

const planA = helloFreshSearchPlan("salmon", "seed-a");
const planB = helloFreshSearchPlan("salmon", "seed-b");
assert.equal(JSON.stringify(planA), JSON.stringify(helloFreshSearchPlan("salmon", "seed-a")));
assert.notEqual(JSON.stringify(planA), JSON.stringify(planB));
assert.ok(planA.length >= 3 && planA.length <= 4);

const baA = blueApronSeedPlan("one");
const baB = blueApronSeedPlan("two");
assert.equal(baA.join("|"), blueApronSeedPlan("one").join("|"));
assert.notEqual(baA.join("|"), baB.join("|"));

const sanitized = sanitizeMatchPrefs({
  beef: 0,
  chicken: 0,
  salmon: 1,
  vegetarian: 0,
  seed: "Ab c<script>",
  excludeIds: ["68d65a7ed232ff05cfc495f1", "../etc", "ab", "Salmon-Dinner"],
});
assert.equal(sanitized.prefs.seed, "Abcscript");
assert.deepEqual(sanitized.prefs.excludeIds, ["68d65a7ed232ff05cfc495f1", "salmon-dinner"]);

console.log("protein-coherence: ok");
