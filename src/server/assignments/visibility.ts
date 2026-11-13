import "server-only";

import type { Prisma } from "../../../generated/prisma";

/**
 * Assignments a STUDENT may see:
 * - published (or a draft whose `publishAt` has passed: scheduled
 *   publishing needs no job, it's decided at query time),
 * - in a non-archived class the student is a member of, and
 * - targeting: no groups = the whole class; otherwise the student must be in
 *   at least one of the assignment's groups.
 *
 * Time windows (opensAt / dueAt / extensions) are NOT applied here; the
 * assignment feature decides how to show upcoming and past ones.
 */
export function assignmentWhereVisibleTo(
  userId: string,
): Prisma.AssignmentWhereInput {
  return {
    AND: [
      { OR: [{ published: true }, { publishAt: { lte: new Date() } }] },
      {
        OR: [
          { groups: { none: {} } },
          { groups: { some: { group: { members: { some: { userId } } } } } },
        ],
      },
    ],
    class: { archived: false, memberships: { some: { userId } } },
  };
}

/** Published right now (explicitly or by its schedule)? */
export function isLive(a: { published: boolean; publishAt: Date | null }) {
  return a.published || (a.publishAt !== null && a.publishAt <= new Date());
}
