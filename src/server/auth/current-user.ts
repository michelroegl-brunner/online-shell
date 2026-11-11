import "server-only";

import { cache } from "react";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * The signed-in user as stored in the DB, or null.
 *
 * The JWT is used for identity only. The role is read live from the DB on
 * every request, so changing a role in the DB takes effect immediately
 * instead of when the 10 h session cookie expires. (A role removed in
 * Entra still only lands in the DB on the user's next sign-in.)
 */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true },
  });
});
