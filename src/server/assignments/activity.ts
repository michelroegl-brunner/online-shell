import "server-only";

import { type db as dbType } from "~/server/db";

type Db = typeof dbType;

/**
 * Attempt activity besides commands (AttemptEvent): checks with their
 * result, hints, resets, the setup. The session replay and the class
 * heatmap read it. Logging never breaks the action it records.
 */

export const ACTIVITY_TYPES = [
  "SETUP",
  "CHECK",
  "AUTOCHECK",
  "HINT",
  "RESET",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Per attempt; a stuck auto-check loop can't flood the table. */
const MAX_EVENTS = 5000;
/**
 * Events per attempt that keep their full check output (8000 chars each,
 * so at most ~2.4 MB per attempt). Later ones keep only `detail`.
 */
const MAX_OUTPUTS = 300;

/** First non-empty lines of a check output (what the student saw). */
export function outputSummary(output: string, maxLines = 3) {
  return output
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(0, maxLines)
    .join("\n")
    .slice(0, 500);
}

export async function logActivity(
  db: Db,
  attemptId: string,
  e: {
    type: ActivityType;
    stepId?: string | null;
    ok?: boolean | null;
    detail?: string | null;
    /** Full check output (capped) */
    output?: string | null;
  },
) {
  try {
    const n = await db.attemptEvent.count({ where: { attemptId } });
    if (n >= MAX_EVENTS) return;
    const keepOutput =
      !!e.output &&
      (await db.attemptEvent.count({
        where: { attemptId, output: { not: null } },
      })) < MAX_OUTPUTS;
    await db.attemptEvent.create({
      data: {
        attemptId,
        type: e.type,
        stepId: e.stepId ?? null,
        ok: e.ok ?? null,
        detail: e.detail ?? null,
        output: keepOutput ? e.output!.slice(0, 8000) : null,
      },
    });
  } catch (err) {
    console.error("[activity] could not log", e.type, err);
  }
}
