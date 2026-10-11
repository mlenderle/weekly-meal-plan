#!/usr/bin/env node
/**
 * Source balance, beef-cut balance, and real fetched HelloFresh / Blue Apron cards.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlanFromCandidates, beefCut, sourceKey } from "../worker/src/plan.js";
import { normalizeHelloFreshItem, normalizeJsonLdRecipe } from "../worker/src/normalize.js";
import {
  parseBlueApronRecipe,
  blueApronToJsonLd,
  selectBlueApronTargets,
  blueApronSlugProtein,
  fetchBlueApronPool,
} from "../worker/src/ba.js";
import { BA_CATALOG } from "../worker/src/ba-catalog.js";
import { recipeIssues } from "../worker/src/protein.js";

function load(name) {
  return JSON.parse(readFileSync(new URL("../worker/fixtures/" + name, import.meta.url), "utf8"));
}

function meal(partial) {
  return {
    id: partial.id,
    name: partial.name,
    protein: partial.protein,
    source: partial.source || "HelloFresh",
    ingredients: partial.ingredients,
    steps: partial.steps,
    healthy: true,
    cheapScore: partial.cheapScore ?? 50,
    avoidTags: [],
  };
}

const salmon = load("hf-sweet-soy-salmon.json");
const keptSalmon = normalizeHelloFreshItem(salmon);
assert.ok(keptSalmon, recipeIssues({ ...salmon, protein: "salmon", ingredients: salmon.ingredients.map((i) => i.name), steps: salmon.steps.map((s) => s.instructions) }).join(","));
assert.equal(keptSalmon.protein, "salmon");
assert.equal(keptSalmon.source, "HelloFresh");
assert.match(keptSalmon.steps.join(" "), /\bsalmon\b/i);
assert.doesNotMatch(keptSalmon.steps.join(" "), /\bchicken\b/i);

const template = load("hf-salmon-chicken-template.json");
assert.equal(normalizeHelloFreshItem(template), null, template.name);

const ground = load("hf-ground-beef.json");
const keptGround = normalizeHelloFreshItem(ground);
assert.ok(keptGround, ground.name);
assert.equal(keptGround.protein, "beef");
assert.equal(beefCut(keptGround), "ground");
assert.match(keptGround.ingredients.join(" "), /Ground Beef/);
assert.doesNotMatch(keptGround.steps.join(" "), /\b(chicken|salmon|pork)\b/i);

function wrapBa(fixture) {
  return `<title>${fixture.title}</title><script>{"ingredients":${JSON.stringify(fixture.ingredients)},"preparation_steps":${JSON.stringify(fixture.preparation_steps)}}</script>`;
}

function baMeal(file) {
  const fixture = load(file);
  const parsed = parseBlueApronRecipe(wrapBa(fixture), "https://www.blueapron.com/recipes/standard-meal-kit/" + file);
  assert.ok(parsed && parsed.name, file);
  const ld = blueApronToJsonLd(parsed);
  return normalizeJsonLdRecipe(ld, "Blue Apron", parsed.url);
}

const steak = baMeal("ba-brown-butter-steaks.json");
assert.ok(steak, "brown butter steaks");
assert.equal(steak.source, "Blue Apron");
assert.equal(steak.protein, "beef");
assert.equal(beefCut(steak), "steak");
assert.match(steak.steps.join(" "), /\bsteaks?\b/i);
assert.match(steak.ingredients.join(" "), /Flank Steaks/);

const chicken = baMeal("ba-artichoke-chicken.json");
assert.ok(chicken, "artichoke chicken");
assert.equal(chicken.protein, "chicken");
assert.equal(sourceKey(chicken), "ba");
assert.match(chicken.steps.join(" "), /\bchicken\b/i);
assert.doesNotMatch(chicken.steps.join(" "), /\b(beef|salmon|pork)\b/i);

assert.equal(baMeal("ba-falafel-shrimp-mismatch.json"), null, "falafel page that ships shrimp is dropped");
assert.equal(baMeal("ba-asian-beef-pork-mismatch.json"), null, "beef title with pork ingredients and mixed steps is dropped");

assert.equal(parseBlueApronRecipe("<html><title>Just a moment...</title></html>", "https://www.blueapron.com/x"), null);

const targets = selectBlueApronTargets(BA_CATALOG, ["beef", "chicken", "salmon"], "balance");
const byProtein = { beef: 0, chicken: 0, salmon: 0 };
for (const row of targets) byProtein[blueApronSlugProtein(row.url)] += 1;
assert.ok(byProtein.beef >= 2 && byProtein.chicken >= 2 && byProtein.salmon >= 2, JSON.stringify(byProtein));
const beefUrls = targets.filter((row) => blueApronSlugProtein(row.url) === "beef").map((row) => row.url);
assert.ok(beefUrls.some((url) => /steak|flank|sirloin/.test(url)));
assert.ok(beefUrls.some((url) => /burger|bolognese|bao/.test(url)));

const blocked = await fetchBlueApronPool(async () => ({
  ok: true,
  text: async () => "<html><title>Just a moment...</title><p>challenge</p></html>",
}), "seed", ["beef"], [{ url: "https://www.blueapron.com/recipes/standard-meal-kit/brown-butter-steaks", timestamp: "" }]);
assert.equal(blocked.pages.length, 0);
assert.match(blocked.error || "", /blocked|readable/);

function card(id, protein, cut, source) {
  const proteinWord = protein === "beef"
    ? (cut === "ground" ? "Ground Beef" : cut === "steak" ? "Sirloin Steak" : "Beef")
    : protein === "chicken" ? "Chicken" : "Salmon";
  const side = protein === "beef" && cut === "ground" ? "Potato Bun" : "Potatoes";
  return meal({
    id,
    name: proteinWord + " Dinner " + id,
    protein,
    source,
    ingredients: ["10 oz " + proteinWord, "12 oz " + side, "1 Lemon", "1 tsp Salt"],
    steps: [
      "Rinse the produce and dice the potatoes.",
      "Cook the " + proteinWord.toLowerCase() + " until done.",
      "Serve with the potatoes.",
    ],
  });
}

const mixed = {};
for (const [id, protein, cut, source] of [
  ["hf-steak", "beef", "steak", "HelloFresh"],
  ["ba-steak", "beef", "steak", "Blue Apron"],
  ["hf-ground", "beef", "ground", "HelloFresh"],
  ["ba-ground", "beef", "ground", "Blue Apron"],
  ["hf-chick", "chicken", "other", "HelloFresh"],
  ["ba-chick", "chicken", "other", "Blue Apron"],
]) {
  mixed[id] = card(id, protein, cut, source);
}
const plan = buildPlanFromCandidates(mixed, {
  beef: 2, chicken: 2, salmon: 0, vegetarian: 0, seed: "mix",
});
const beefSlots = plan.slots.filter((s) => s.protein === "beef").map((s) => mixed[s.mealId]);
const chickenSlots = plan.slots.filter((s) => s.protein === "chicken").map((s) => mixed[s.mealId]);
assert.equal(new Set(beefSlots.map(sourceKey)).size, 2, beefSlots.map((m) => m.id).join(","));
assert.equal(new Set(beefSlots.map(beefCut)).size, 2, beefSlots.map((m) => beefCut(m) + " " + m.id).join(","));
assert.equal(new Set(chickenSlots.map(sourceKey)).size, 2, chickenSlots.map((m) => m.id).join(","));

console.log("recipe-balance: ok");
