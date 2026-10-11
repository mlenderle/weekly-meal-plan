import { recipeHitsAvoid } from "./normalize.js";
import { makeRng, shuffle } from "./random.js";

function rankPool(pool, prefs, rng) {
  const shuffled = shuffle(pool, rng);
  if (!prefs.cheapBias) return shuffled;
  // Wide bands so a one-point staple score cannot pin the same recipe every time.
  return shuffled.sort((a, b) => Math.floor((b.cheapScore || 0) / 15) - Math.floor((a.cheapScore || 0) / 15));
}

export function sourceKey(meal) {
  return /blue apron/i.test(String((meal && meal.source) || "")) ? "ba" : "hf";
}

/** Steak, ground beef, or another beef cut. Pepper "ground" does not count. */
export function beefCut(meal) {
  const blob = `${(meal && meal.name) || ""} ${((meal && meal.ingredients) || []).join(" ")}`.toLowerCase();
  const ground = /\b(ground beef|burger|cheeseburger|meatball|bolognese)\b/.test(blob);
  const steak = /\b(steak|sirloin|rib-?eye|bavette|flank|skirt|tenderloin|filet|brisket|short rib)\b/.test(blob);
  if (ground && !steak) return "ground";
  if (steak && !ground) return "steak";
  if (ground && steak) return "mixed";
  return "other";
}

function pickOne(ranked, protein, already) {
  if (!ranked.length) return null;
  const haveBa = ranked.some((m) => sourceKey(m) === "ba");
  const haveHf = ranked.some((m) => sourceKey(m) === "hf");
  const baN = already.filter((m) => sourceKey(m) === "ba").length;
  const hfN = already.filter((m) => sourceKey(m) === "hf").length;
  const cuts = new Set(ranked.map(beefCut));
  const usedCuts = new Set(already.map(beefCut));
  const unusedCuts = [...cuts].filter((c) => !usedCuts.has(c));
  let best = null;
  let bestScore = Infinity;
  ranked.forEach((m, index) => {
    let score = index;
    if (haveBa && haveHf && baN !== hfN) {
      const want = baN < hfN ? "ba" : "hf";
      if (sourceKey(m) !== want) score += 100;
    }
    if (protein === "beef" && unusedCuts.length && !unusedCuts.includes(beefCut(m))) score += 40;
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  });
  return best;
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
  const picked = { beef: [], chicken: [], salmon: [], vegetarian: [] };

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
    // Already-shown ids are never a fallback. An empty pool becomes a shortage.
    const fresh = pool.filter((m) => !exclude.has(m.id));
    return rankPool(fresh, prefs, rng);
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
    const primary = pickOne(ranked, protein, picked[protein]);
    if (!primary) {
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
    picked[protein].push(primary);
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
