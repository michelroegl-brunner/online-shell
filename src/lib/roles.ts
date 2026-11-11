// Edge-safe role helpers (no Prisma runtime import).
export type AppRole = "ADMIN" | "TEACHER" | "STUDENT";

export const isStaff = (role: AppRole | undefined | null) =>
  role === "ADMIN" || role === "TEACHER";

/** Where a user lands after sign-in. */
export const homeFor = (role: AppRole) => (isStaff(role) ? "/admin" : "/learn");
