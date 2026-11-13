import "server-only";

import { type db as dbType } from "~/server/db";
import { assignmentWhereVisibleTo } from "./visibility";
import { windowState } from "./window";

type Db = typeof dbType;

/**
 * Exam mode (Assignment.mode = EXAM):
 * - while an exam is open for a student and not handed in, their box only
 *   serves that exam: the playground and other assignments are locked
 *   (they share one box, so anything else would be a way around the lock);
 * - focus loss / leaving fullscreen is logged as ExamEvents;
 * - check output is hidden (only passed / not passed);
 * - "Hand in" (AssignmentSubmission) closes it for that student until a
 *   teacher reopens it.
 */
export type OpenExam = { id: string; title: string; slugs: string[] };

/** Exams that are open right now for this student and not handed in. */
export async function openExamsFor(
  db: Db,
  user: { id: string; role: string },
): Promise<OpenExam[]> {
  if (user.role !== "STUDENT") return [];
  const exams = await db.assignment.findMany({
    where: {
      AND: [
        assignmentWhereVisibleTo(user.id),
        { mode: "EXAM" },
        { submissions: { none: { userId: user.id } } },
      ],
    },
    select: {
      id: true,
      title: true,
      opensAt: true,
      dueAt: true,
      extensions: {
        where: { userId: user.id },
        select: { extraMinutes: true },
      },
      items: { select: { exercise: { select: { slug: true } } } },
    },
  });
  return exams
    .filter((a) => windowState(a, a.extensions[0]?.extraMinutes) === "open")
    .map((a) => ({
      id: a.id,
      title: a.title,
      slugs: a.items.map((i) => i.exercise.slug),
    }));
}

export const EXAM_EVENT_TYPES = ["BLUR", "HIDDEN", "FULLSCREEN_EXIT"] as const;
export type ExamEventType = (typeof EXAM_EVENT_TYPES)[number];
