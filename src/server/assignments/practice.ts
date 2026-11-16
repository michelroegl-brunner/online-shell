import "server-only";

import { type db as dbType } from "~/server/db";

type Db = typeof dbType;

/**
 * "Practise your weak spots": a student turns a weak topic (tag) into a
 * personal practice set — an Assignment with `practiceForId` = them, made
 * of SHARED library exercises with that tag. Only they see it; teachers'
 * lists, reports and grades leave it out (access.ts, visibility.ts).
 *
 * Exercises that could give something away are never picked:
 * - anything used in an assignment of the student's classes (they meet it
 *   there, graded), and
 * - anything used in an exam that hasn't closed yet, in any class.
 */

/** Exercises per practice set. */
export const PRACTICE_SIZE = 3;

export async function practiceCandidates(
  db: Db,
  userId: string,
  tag: string,
  limit = PRACTICE_SIZE,
) {
  const now = new Date();
  return db.exercise.findMany({
    where: {
      visibility: "SHARED",
      archived: false,
      kind: "EXERCISE",
      tags: { has: tag },
      steps: { some: {} },
      assignmentItems: {
        none: {
          OR: [
            {
              assignment: {
                practiceForId: null,
                class: { memberships: { some: { userId } } },
              },
            },
            {
              assignment: {
                mode: "EXAM",
                OR: [{ dueAt: null }, { dueAt: { gt: now } }],
              },
            },
            // Already in one of my practice sets and solved there.
            {
              assignment: { practiceForId: userId },
              attempts: { some: { userId, status: "PASSED" } },
            },
          ],
        },
      },
    },
    orderBy: [
      { difficulty: "asc" },
      { assignmentItems: { _count: "desc" } },
      { title: "asc" },
    ],
    take: limit,
    select: { id: true, title: true, difficulty: true, shell: true },
  });
}

/** How many practice exercises exist per tag (for the "Practise" buttons). */
export async function practiceAvailability(
  db: Db,
  userId: string,
  tags: string[],
) {
  const out: Record<string, number> = {};
  await Promise.all(
    tags.map(async (t) => {
      out[t] = (await practiceCandidates(db, userId, t)).length;
    }),
  );
  return out;
}

/**
 * My open practice set for a tag (one with something left to solve), or a
 * new one. Returns null when the library has nothing to practise with.
 */
export async function startPractice(db: Db, userId: string, tag: string) {
  const open = await db.assignment.findFirst({
    where: {
      practiceForId: userId,
      practiceTag: tag,
      items: {
        some: {
          attempts: { none: { userId, status: "PASSED" } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (open) return { id: open.id, created: false };

  const membership = await db.classMembership.findFirst({
    where: { userId, class: { archived: false } },
    orderBy: { class: { name: "asc" } },
    select: { classId: true },
  });
  if (!membership) return null;

  const picks = await practiceCandidates(db, userId, tag);
  if (picks.length === 0) return null;

  const a = await db.assignment.create({
    data: {
      title: `Practice: ${tag}`,
      classId: membership.classId,
      practiceForId: userId,
      practiceTag: tag,
      mode: "PRACTICE",
      published: true,
      allowHints: true,
      hintPenalty: 0,
      allowCheatSheet: true,
      allowPaste: false,
      maxChecks: null,
      items: {
        create: picks.map((e, order) => ({ exerciseId: e.id, order })),
      },
    },
    select: { id: true },
  });
  return { id: a.id, created: true };
}

/** My practice sets with progress (newest first). */
export async function myPracticeSets(db: Db, userId: string) {
  const sets = await db.assignment.findMany({
    where: { practiceForId: userId, class: { archived: false } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      practiceTag: true,
      createdAt: true,
      items: {
        select: {
          attempts: { where: { userId }, select: { status: true } },
        },
      },
    },
  });
  return sets.map((s) => ({
    id: s.id,
    title: s.title,
    tag: s.practiceTag,
    createdAt: s.createdAt,
    total: s.items.length,
    solved: s.items.filter((i) => i.attempts[0]?.status === "PASSED").length,
  }));
}
