import "server-only";

import type { Prisma } from "../../../generated/prisma";

/**
 * Assignments a STUDENT may see:
 * - published, in a non-archived class the student is a member of, and
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
    published: true,
    class: { archived: false, memberships: { some: { userId } } },
    OR: [
      { groups: { none: {} } },
      { groups: { some: { group: { members: { some: { userId } } } } } },
    ],
  };
}
