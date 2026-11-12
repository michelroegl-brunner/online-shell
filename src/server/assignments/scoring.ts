/**
 * Scoring for (multi-step) exercises inside an assignment.
 *
 * Each step has its own points; the exercise is worth the sum. An
 * assignment item may override the exercise's total (AssignmentItem.points);
 * then the earned step points are scaled proportionally.
 */

export const itemMaxPoints = (override: number | null, exerciseTotal: number) =>
  override ?? exerciseTotal;

export function itemScore(
  earnedStepPoints: number,
  stepTotal: number,
  override: number | null,
) {
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
