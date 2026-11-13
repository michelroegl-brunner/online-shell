import "server-only";

import { type db as dbType } from "~/server/db";
import { isLesson, itemMaxPoints, itemScore } from "./scoring";
import { assignmentWhereVisibleTo } from "./visibility";
import { effectiveDueAt, windowState } from "./window";

type Db = typeof dbType;

/**
 * A student's progress across all assignments visible to them:
 * points over time, results per tag, and "weak topics" (tags with the
 * lowest solve rate) with the open exercises to practise them on.
 */

export type TagStat = {
  tag: string;
  /** Assigned exercises with this tag. */
  exercises: number;
  solved: number;
  stepsPassed: number;
  steps: number;
  /** Checks per passed step (1 = solved on the first try). */
  checksPerStep: number | null;
  hintsUsed: number;
  points: number;
  maxPoints: number;
};

export type PracticeItem = {
  assignmentId: string;
  itemId: string;
  title: string;
  assignment: string;
  shell: "BASH" | "PWSH";
  difficulty: number;
  stepsPassed: number;
  steps: number;
  dueAt: Date | null;
};

/** Below this solve rate (or with no solved exercise yet) a tag is "weak". */
const WEAK_RATE = 0.75;
/** More checks per passed step than this also marks a tag as weak. */
const WEAK_CHECKS = 3;

export async function studentProgress(db: Db, userId: string) {
  const assignments = await db.assignment.findMany({
    where: assignmentWhereVisibleTo(userId),
    select: {
      id: true,
      title: true,
      mode: true,
      opensAt: true,
      dueAt: true,
      extensions: { where: { userId }, select: { extraMinutes: true } },
      submissions: { where: { userId }, select: { submittedAt: true } },
      items: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          points: true,
          exercise: {
            select: {
              title: true,
              shell: true,
              kind: true,
              difficulty: true,
              tags: true,
              points: true,
              steps: { select: { id: true, points: true } },
            },
          },
          attempts: {
            where: { userId },
            select: {
              status: true,
              score: true,
              hintsUsed: true,
              steps: {
                select: {
                  stepId: true,
                  status: true,
                  checks: true,
                  passedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const events: { at: Date; points: number }[] = [];
  const tags = new Map<string, TagStat & { checks: number }>();
  const unsolvedByTag = new Map<string, PracticeItem[]>();
  let points = 0;
  let maxPoints = 0;
  let solved = 0;
  let exercises = 0;

  for (const a of assignments) {
    const extra = a.extensions[0]?.extraMinutes;
    const open = a.submissions.length === 0 && windowState(a, extra) === "open";
    for (const item of a.items) {
      const ex = item.exercise;
      const att = item.attempts[0];
      const stepTotal = ex.steps.reduce((s, x) => s + x.points, 0);
      // Lessons are worth 0 (scoring.ts); their completion still counts.
      const max = itemMaxPoints(item.points, ex.points, ex.kind);
      const progress = new Map((att?.steps ?? []).map((s) => [s.stepId, s]));
      const passedSteps = ex.steps.filter(
        (s) => progress.get(s.id)?.status === "PASSED",
      );
      const isSolved = att?.status === "PASSED";
      const score = isLesson(ex.kind) ? 0 : (att?.score ?? 0);

      exercises += 1;
      maxPoints += max;
      points += score;
      if (isSolved) solved += 1;

      // Timeline: each solved step adds its (scaled) points when it passed.
      for (const s of isLesson(ex.kind) ? [] : passedSteps) {
        const at = progress.get(s.id)?.passedAt;
        if (at)
          events.push({
            at,
            points: itemScore(s.points, stepTotal, item.points, ex.kind),
          });
      }

      const checks = passedSteps.reduce(
        (sum, s) => sum + (progress.get(s.id)?.checks ?? 0),
        0,
      );
      const exTags = ex.tags.length ? ex.tags : ["untagged"];
      for (const tag of exTags) {
        const t = tags.get(tag) ?? {
          tag,
          exercises: 0,
          solved: 0,
          stepsPassed: 0,
          steps: 0,
          checksPerStep: null,
          hintsUsed: 0,
          points: 0,
          maxPoints: 0,
          checks: 0,
        };
        t.exercises += 1;
        t.solved += isSolved ? 1 : 0;
        t.stepsPassed += passedSteps.length;
        t.steps += ex.steps.length;
        t.checks += checks;
        t.hintsUsed += att?.hintsUsed ?? 0;
        t.points += score;
        t.maxPoints += max;
        tags.set(tag, t);

        if (!isSolved && open) {
          const list = unsolvedByTag.get(tag) ?? [];
          list.push({
            assignmentId: a.id,
            itemId: item.id,
            title: ex.title,
            assignment: a.title,
            shell: ex.shell,
            difficulty: ex.difficulty,
            stepsPassed: passedSteps.length,
            steps: ex.steps.length,
            dueAt: effectiveDueAt(a.dueAt, extra),
          });
          unsolvedByTag.set(tag, list);
        }
      }
    }
  }

  // Cumulative points per day.
  events.sort((x, y) => x.at.getTime() - y.at.getTime());
  const timeline: { day: string; points: number; gained: number }[] = [];
  let running = 0;
  for (const e of events) {
    running += e.points;
    const day = e.at.toISOString().slice(0, 10);
    const last = timeline[timeline.length - 1];
    if (last?.day === day) {
      last.points = running;
      last.gained += e.points;
    } else {
      timeline.push({ day, points: running, gained: e.points });
    }
  }

  const tagStats: TagStat[] = [...tags.values()]
    .map(({ checks, ...t }) => ({
      ...t,
      checksPerStep: t.stepsPassed ? checks / t.stepsPassed : null,
    }))
    .sort((x, y) => y.exercises - x.exercises || x.tag.localeCompare(y.tag));

  const rate = (t: TagStat) => (t.steps ? t.stepsPassed / t.steps : 0);
  const weak = tagStats
    .filter(
      (t) =>
        rate(t) < WEAK_RATE ||
        (t.checksPerStep !== null && t.checksPerStep > WEAK_CHECKS),
    )
    .sort(
      (x, y) =>
        rate(x) - rate(y) || (y.checksPerStep ?? 0) - (x.checksPerStep ?? 0),
    )
    .slice(0, 5)
    .map((t) => ({
      tag: t.tag,
      rate: rate(t),
      checksPerStep: t.checksPerStep,
      // Easiest first: a good way back into the topic.
      practice: (unsolvedByTag.get(t.tag) ?? [])
        .sort((x, y) => x.difficulty - y.difficulty)
        .slice(0, 4),
    }));

  return {
    totals: { points, maxPoints, solved, exercises },
    timeline,
    tags: tagStats,
    weak,
  };
}
