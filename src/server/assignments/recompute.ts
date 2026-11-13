import "server-only";

import { type db as dbType } from "~/server/db";
import { itemScore } from "./scoring";

type Db = typeof dbType;

/**
 * Recompute an attempt's totals from its step rows. A teacher's
 * `scoreOverride` wins over the computed score while it is set. Lessons
 * score 0 (see scoring.ts) but still become PASSED when all steps are.
 */
export async function recomputeAttempt(
  db: Db,
  attemptId: string,
  steps: { id: string; points: number }[],
  override: number | null,
) {
  const rows = await db.attemptStep.findMany({ where: { attemptId } });
  const byId = new Map(rows.map((r) => [r.stepId, r]));
  const earned = steps.reduce(
    (s, st) => s + (byId.get(st.id)?.status === "PASSED" ? st.points : 0),
    0,
  );
  const total = steps.reduce((s, st) => s + st.points, 0);
  const allPassed =
    steps.length > 0 &&
    steps.every((st) => byId.get(st.id)?.status === "PASSED");
  const anyPassed = earned > 0 || rows.some((r) => r.status === "PASSED");
  const current = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      finishedAt: true,
      scoreOverride: true,
      assignmentItem: { select: { exercise: { select: { kind: true } } } },
    },
  });
  const kind = current.assignmentItem.exercise.kind;
  const computed = anyPassed ? itemScore(earned, total, override, kind) : null;
  return db.attempt.update({
    where: { id: attemptId },
    data: {
      status: allPassed ? "PASSED" : "IN_PROGRESS",
      score: current.scoreOverride ?? computed,
      checks: rows.reduce((s, r) => s + r.checks, 0),
      hintsUsed: rows.reduce((s, r) => s + r.hintsUsed, 0),
      finishedAt: allPassed ? (current.finishedAt ?? new Date()) : null,
    },
  });
}

/** Recompute an attempt when only its id is known (loads the steps). */
export async function recomputeAttemptById(db: Db, attemptId: string) {
  const att = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      assignmentItem: {
        select: {
          points: true,
          exercise: {
            select: { steps: { select: { id: true, points: true } } },
          },
        },
      },
    },
  });
  return recomputeAttempt(
    db,
    attemptId,
    att.assignmentItem.exercise.steps,
    att.assignmentItem.points,
  );
}
