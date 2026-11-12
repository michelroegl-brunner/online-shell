import "server-only";

import { type db as Db } from "~/server/db";
import { assignmentWhereVisibleTo } from "./visibility";
import { windowState } from "./window";

export type PastePolicy = {
  /** Pasting allowed right now. */
  allowed: boolean;
  /**
   * If allowed now: the moment a no-paste assignment of this student opens,
   * so a terminal opened earlier switches to "blocked" at that time.
   */
  blockFrom: Date | null;
};

/**
 * May this user paste into their terminals?
 *
 * All terminals of a student share one box, so the rule is per student, not
 * per terminal: as long as any assignment that is OPEN for them forbids
 * pasting (Assignment.allowPaste = false), pasting is blocked everywhere —
 * otherwise they could paste in the playground and cd into the exercise.
 * Teachers/admins may always paste.
 *
 * Decided when a terminal connects. `blockFrom` covers assignments that
 * open later; one that is published while a terminal is open applies from
 * the next connect.
 */
export async function pastePolicyFor(
  db: typeof Db,
  user: { id: string; role: string },
): Promise<PastePolicy> {
  if (user.role !== "STUDENT") return { allowed: true, blockFrom: null };
  const noPaste = await db.assignment.findMany({
    where: { AND: [assignmentWhereVisibleTo(user.id), { allowPaste: false }] },
    select: {
      opensAt: true,
      dueAt: true,
      extensions: {
        where: { userId: user.id },
        select: { extraMinutes: true },
      },
    },
  });
  const states = noPaste.map((a) => ({
    a,
    state: windowState(a, a.extensions[0]?.extraMinutes),
  }));
  if (states.some((s) => s.state === "open")) {
    return { allowed: false, blockFrom: null };
  }
  const upcoming = states
    .filter((s) => s.state === "upcoming" && s.a.opensAt)
    .map((s) => s.a.opensAt!.getTime());
  return {
    allowed: true,
    blockFrom: upcoming.length ? new Date(Math.min(...upcoming)) : null,
  };
}

/** Convenience: is pasting allowed right now? */
export async function pasteAllowedFor(
  db: typeof Db,
  user: { id: string; role: string },
) {
  return (await pastePolicyFor(db, user)).allowed;
}
