import "server-only";

import { type db as Db } from "~/server/db";
import { assignmentWhereVisibleTo } from "./visibility";
import { windowState } from "./window";

/**
 * May this user paste into their terminals right now?
 *
 * All terminals of a student share one box, so the rule is per student, not
 * per terminal: as long as any assignment that is OPEN for them forbids
 * pasting (Assignment.allowPaste = false), pasting is blocked everywhere —
 * otherwise they could paste in the playground and cd into the exercise.
 * Teachers/admins may always paste.
 */
export async function pasteAllowedFor(
  db: typeof Db,
  user: { id: string; role: string },
): Promise<boolean> {
  if (user.role !== "STUDENT") return true;
  const blocking = await db.assignment.findMany({
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
  return !blocking.some(
    (a) => windowState(a, a.extensions[0]?.extraMinutes) === "open",
  );
}
