import "server-only";

import { db } from "~/server/db";
import type { Role } from "../../../generated/prisma";

/** Create or update the local user on every sign-in. */
export async function upsertUser(input: {
  entraOid: string;
  email: string;
  name: string;
  role: Role;
}) {
  const email = input.email.toLowerCase();
  return db.user.upsert({
    where: { entraOid: input.entraOid },
    create: { ...input, email, lastLoginAt: new Date() },
    update: {
      email,
      name: input.name,
      role: input.role,
      lastLoginAt: new Date(),
    },
    select: { id: true, role: true },
  });
}

/**
 * Sync class memberships from the user's M365 groups. Only groups that a
 * teacher already imported as a Class count; everything else is ignored.
 * Teachers/admins are never class members (same rule as class.syncMembers).
 *
 * Only memberships of M365-backed classes are managed here. Hand-made
 * classes (entraGroupId "dev:…", e.g. a test class) keep their members.
 */
export async function syncClassMemberships(userId: string, groupIds: string[]) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const isStudent = user?.role === "STUDENT";
  const classes = isStudent
    ? await db.class.findMany({
        where: { entraGroupId: { in: groupIds } },
        select: { id: true },
      })
    : [];
  const classIds = classes.map((c) => c.id);
  await db.$transaction([
    db.classMembership.deleteMany({
      where: {
        userId,
        classId: { notIn: classIds },
        class: { NOT: { entraGroupId: { startsWith: "dev:" } } },
      },
    }),
    db.classMembership.createMany({
      data: classIds.map((classId) => ({ userId, classId })),
      skipDuplicates: true,
    }),
    // Left a class → also leave that class's groups.
    db.classGroupMember.deleteMany({
      where: {
        userId,
        group: { class: { memberships: { none: { userId } } } },
      },
    }),
  ]);
}
