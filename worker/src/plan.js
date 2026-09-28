import { recipeHitsAvoid } from "./normalize.js";
import { makeRng, shuffle } from "./random.js";

function rankPool(pool, prefs, rng) {
  const shuffled = shuffle(pool, rng);
  if (!prefs.cheapBias) return shuffled;
  // Prefer cheaper-grocery bands, but shuffle inside a band so ties are not sticky.
  return shuffled.sort((a, b) => Math.floor((b.cheapScore || 0) / 10) - Math.floor((a.cheapScore || 0) / 10));
}

export function buildPlanFromCandidates(candidates, prefs) {
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = {
    beef: Math.max(0, Math.min(7, Number(prefs.beef) || 0)),
    chicken: Math.max(0, Math.min(7, Number(prefs.chicken) || 0)),
    salmon: Math.max(0, Math.min(7, Number(prefs.salmon) || 0)),
    vegetarian: Math.max(0, Math.min(7, Number(prefs.vegetarian) || 0)),
  };
  const total = counts.beef + counts.chicken + counts.salmon + counts.vegetarian;
  if (total < 1 || total > 7) {
    return { error: total < 1 ? "Pick at least one dinner." : "Cap dinners at 7 (one week)." };
  }

  const avoid = new Set((prefs.avoid || []).map((a) => String(a).toLowerCase()));
  const customAvoid = prefs.customAvoid || [];
  const healthyOnly = !!prefs.healthyOnly;

  const list = Object.values(candidates);
  function eligible(protein) {
    return list.filter((m) => {
      if (m.protein !== protein) return false;
      if (healthyOnly && !m.healthy) return false;
      if (recipeHitsAvoid(m, avoid, customAvoid)) return false;
      return true;
    });
  }

  const mix = [];
  for (let i = 0; i < counts.beef; i++) mix.push("beef");
  for (let i = 0; i < counts.chicken; i++) mix.push("chicken");
  for (let i = 0; i < counts.salmon; i++) mix.push("salmon");
  for (let i = 0; i < counts.vegetarian; i++) mix.push("vegetarian");

  const ordered = [];
  const queues = { beef: [], chicken: [], salmon: [], vegetarian: [] };
  mix.forEach((p) => queues[p].push(p));
  while (ordered.length < mix.length) {
    for (const p of ["beef", "chicken", "salmon", "vegetarian"]) {
      if (queues[p].length) ordered.push(queues[p].shift());
    }
  }

  const used = new Set();
  const usedTitles = new Set();
  const slots = [];
  const shortages = [];
  const labels = dayLabels.slice(0, total);
  const rng = makeRng(`${prefs.seed || "meal"}|plan`);
  const exclude = new Set((prefs.excludeIds || []).map((id) => String(id)));

  function titleKey(m) {
    return String(m.name || "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/\b2x\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function choose(pool) {
    const fresh = pool.filter((m) => !exclude.has(m.id));
    return rankPool(fresh.length ? fresh : pool, prefs, rng);
  }

  ordered.forEach((protein, idx) => {
    const base = eligible(protein).filter((m) => !used.has(m.id));
    let pool = base.filter((m) => !usedTitles.has(titleKey(m)));
    if (!pool.length) pool = base.length ? base : eligible(protein);
    if (!pool.length) {
      shortages.push(protein);
      slots.push({
        day: labels[idx],
        protein,
        mealId: null,
        kept: false,
        swapOpen: true,
        alternateIds: [],
      });
      return;
    }
    const ranked = choose(pool);
    const primary = ranked[0];
    used.add(primary.id);
    usedTitles.add(titleKey(primary));
    slots.push({
      day: labels[idx],
      protein,
      mealId: primary.id,
      kept: true,
      swapOpen: false,
      alternateIds: ranked.slice(1, 4).map((m) => m.id),
    });
  });

  slots.forEach((s) => {
    if (!s.mealId) return;
    const current = list.find((m) => m.id === s.mealId);
    const differentTitle = eligible(s.protein).filter((m) => m.id !== s.mealId && titleKey(m) !== titleKey(current || {}));
    const altPool = differentTitle.length
      ? differentTitle
      : eligible(s.protein).filter((m) => m.id !== s.mealId);
    s.alternateIds = choose(altPool).slice(0, 3).map((m) => m.id);
  });

  return { slots, shortages, total, counts };
}
