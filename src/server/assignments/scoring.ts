/**
 * Scoring for (multi-step) exercises inside an assignment.
 *
 * Each step has its own points; the exercise is worth the sum. An
 * assignment item may override the exercise's total (AssignmentItem.points);
 * then the earned step points are scaled proportionally.
 *
 * Lessons (Exercise.kind = LESSON) are guided walkthroughs: they are always
 * worth 0 points, whatever their steps or an item override say, so they
 * never change totals or grades. Their completion is still tracked.
 */

export type ExerciseKind = "EXERCISE" | "LESSON";

export const isLesson = (kind: ExerciseKind | null | undefined) =>
  kind === "LESSON";

export const itemMaxPoints = (
  override: number | null,
  exerciseTotal: number,
  kind?: ExerciseKind,
) => (isLesson(kind) ? 0 : (override ?? exerciseTotal));

export function itemScore(
  earnedStepPoints: number,
  stepTotal: number,
  override: number | null,
  kind?: ExerciseKind,
) {
  if (isLesson(kind)) return 0;
  if (override === null) return earnedStepPoints;
  if (stepTotal <= 0) return 0;
  return Math.round((override * earnedStepPoints) / stepTotal);
}

/**
 * A step is open if it's the first one, doesn't require the previous step,
 * or the previous step is solved.
 */
export function stepUnlocked(
  index: number,
  requiresPrevious: boolean,
  previousPassed: boolean,
) {
  return index === 0 || !requiresPrevious || previousPassed;
}

/**
 * Gates: an assignment item with `gate` must be solved before the items
 * after it open. Given the items in order, returns per item the title of
 * the first earlier gate that isn't solved yet (null = open).
 */
export function gateLocks(
  items: { gate: boolean; title: string; passed: boolean }[],
): (string | null)[] {
  let blocker: string | null = null;
  return items.map((i) => {
    const locked = blocker;
    if (!blocker && i.gate && !i.passed) blocker = i.title;
    return locked;
  });
}
