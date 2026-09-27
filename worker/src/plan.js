import { recipeHitsAvoid } from "./normalize.js";

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  const slots = [];
  const shortages = [];
  const labels = dayLabels.slice(0, total);

  ordered.forEach((protein, idx) => {
    let pool = eligible(protein).filter((m) => !used.has(m.id));
    if (!pool.length) pool = eligible(protein);
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
    const ranked = prefs.cheapBias
      ? pool.slice().sort((a, b) => (b.cheapScore || 0) - (a.cheapScore || 0) || String(a.name).localeCompare(String(b.name)))
      : shuffle(pool);
    const primary = ranked[0];
    used.add(primary.id);
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
    const altPool = eligible(s.protein).filter((m) => m.id !== s.mealId);
    const altRanked = prefs.cheapBias
      ? altPool.slice().sort((a, b) => (b.cheapScore || 0) - (a.cheapScore || 0) || String(a.name).localeCompare(String(b.name)))
      : shuffle(altPool);
    s.alternateIds = altRanked.slice(0, 3).map((m) => m.id);
  });

  return { slots, shortages, total, counts };
}
