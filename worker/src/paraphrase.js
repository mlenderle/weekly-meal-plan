/**
 * Light paraphrase of kit card steps: keep temps/times/amounts, reword
 * instructional prose so we are not dumping wholesale card copy.
 */

const OPENERS = [
  [/^Wash and dry (all )?produce\.?/i, "Rinse and dry the produce."],
  [/^Meanwhile,?\s*/i, "At the same time, "],
  [/^Adjust (oven )?rack[^.]*\.\s*/i, "Set the oven rack and "],
  [/^Preheat oven to/i, "Heat the oven to"],
];

export function paraphraseStep(text, stepIndex) {
  if (!text) return "";
  let t = String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/[•\u2022]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*TIP:\s*/gi, " Note: ")
    .trim();

  for (const [re, rep] of OPENERS) {
    if (re.test(t)) t = t.replace(re, rep);
  }

  // Soften HelloFresh kit-marketing asides while keeping cooking facts.
  t = t
    .replace(/\bDon'?t skip this step[^.]*\./gi, "")
    .replace(/\busing your hands,?\s*/gi, "")
    .replace(/\(similar to how you would knead dough\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Ensure step index clarity without inventing temperatures.
  if (stepIndex >= 0 && !/^\d+\./.test(t)) {
    // leave unnumbered; UI/PDF numbers steps
  }
  return t;
}

export function paraphraseSteps(steps) {
  return (steps || [])
    .map((s, i) => paraphraseStep(typeof s === "string" ? s : s?.text || s?.instructions || "", i))
    .filter(Boolean);
}
