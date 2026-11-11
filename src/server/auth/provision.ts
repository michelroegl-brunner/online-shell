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
 */
export async function syncClassMemberships(userId: string, groupIds: string[]) {
  const classes = await db.class.findMany({
    where: { entraGroupId: { in: groupIds } },
    select: { id: true },
  });
  const classIds = classes.map((c) => c.id);
  await db.$transaction([
    db.classMembership.deleteMany({
      where: { userId, classId: { notIn: classIds } },
    }),
    db.classMembership.createMany({
      data: classIds.map((classId) => ({ userId, classId })),
      skipDuplicates: true,
    }),
  ]);
}
