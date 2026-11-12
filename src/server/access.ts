import "server-only";

import type { Prisma } from "../../generated/prisma";

/**
 * Shared teacher-side access rules (Prisma where-inputs).
 * Teachers reach the classes they teach (ClassTeacher) and everything in
 * them; admins reach everything.
 */

export type Viewer = { id: string; role: string };

export const isAdmin = (u: Viewer) => u.role === "ADMIN";

export const classWhere = (u: Viewer): Prisma.ClassWhereInput =>
  isAdmin(u) ? {} : { teachers: { some: { userId: u.id } } };

export const assignmentWhere = (u: Viewer): Prisma.AssignmentWhereInput =>
  isAdmin(u) ? {} : { class: classWhere(u) };

/** Exercises a teacher may use: own or SHARED (admins: all). */
export const exerciseReadableWhere = (u: Viewer): Prisma.ExerciseWhereInput =>
  isAdmin(u) ? {} : { OR: [{ authorId: u.id }, { visibility: "SHARED" }] };
