/**
 * Grade scale for exports: percent of the maximum points needed for each
 * grade. Default: the usual Austrian 1–5 scale (Sehr gut … Nicht genügend).
 * Stored per browser.
 */

export type GradeScale = {
  /** Minimum percent for grade 1, 2, 3, 4 (below the last = 5). */
  thresholds: [number, number, number, number];
};

export const DEFAULT_SCALE: GradeScale = { thresholds: [87.5, 75, 62.5, 50] };

const KEY = "oshell.gradeScale";

export function loadScale(): GradeScale {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SCALE;
    const t = (JSON.parse(raw) as GradeScale).thresholds;
    if (
      Array.isArray(t) &&
      t.length === 4 &&
      t.every((x) => typeof x === "number" && x >= 0 && x <= 100)
    ) {
      return { thresholds: t };
    }
  } catch {
    /* private mode / bad value */
  }
  return DEFAULT_SCALE;
}

export function saveScale(s: GradeScale) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function gradeFor(points: number, max: number, s: GradeScale) {
  if (max <= 0) return null;
  const pct = (points / max) * 100;
  const i = s.thresholds.findIndex((t) => pct >= t);
  return i === -1 ? 5 : i + 1;
}

export const GRADE_NAMES = [
  "",
  "Sehr gut",
  "Gut",
  "Befriedigend",
  "Genügend",
  "Nicht genügend",
];
