import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assignmentWhere, classWhere } from "~/server/access";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";
import { parsePasteDetail } from "~/server/assignments/paste-events";
import { itemScore } from "~/server/assignments/scoring";
import { effectiveDueAt } from "~/server/assignments/window";
import { HOME } from "~/server/exercises/run";

/**
 * Teacher reports. Same access as the assignment router: classes the
 * caller teaches (admins: all). Read-only.
 */

const itemPoints = (i: {
  points: number | null;
  exercise: { points: number };
}) => i.points ?? i.exercise.points;

/** Blocked paste attempts of an attempt (ExamEvent rows of type PASTE). */
const pasteEventsSelect = {
  where: { type: "PASTE" },
  select: { detail: true },
} as const;
const pasteCount = (events: { detail: string | null }[]) =>
  events.reduce((n, e) => n + (parsePasteDetail(e.detail)?.count ?? 1), 0);

const minutesBetween = (a: Date, b: Date) =>
  (b.getTime() - a.getTime()) / 60_000;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** `~/exercises/<slug>/sub` instead of the absolute path. */
const shortCwd = (cwd: string | null) =>
  cwd?.startsWith(HOME) ? `~${cwd.slice(HOME.length)}` : (cwd ?? "");

export const reportRouter = createTRPCRouter({
  /**
   * Class × exercise matrix for one assignment, plus per-exercise stats.
   * Rows: targeted students (class members, filtered by the assignment's
   * groups) and anyone else who has an attempt (e.g. moved to another group).
   */
  assignment: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.id }, assignmentWhere(ctx.user)] },
        select: {
          id: true,
          title: true,
          opensAt: true,
          dueAt: true,
          published: true,
          publishAt: true,
          mode: true,
          maxChecks: true,
          submissions: { select: { userId: true, submittedAt: true } },
          class: {
            select: {
              id: true,
              name: true,
              memberships: {
                select: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      lastLoginAt: true,
                    },
                  },
                },
              },
            },
          },
          groups: {
            select: {
              group: {
                select: {
                  id: true,
                  name: true,
                  members: { select: { userId: true } },
                },
              },
            },
          },
          extensions: { select: { userId: true, extraMinutes: true } },
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              points: true,
              exercise: {
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  points: true,
                  _count: { select: { steps: true } },
                  steps: {
                    orderBy: { order: "asc" },
                    select: { id: true, title: true, points: true },
                  },
                },
              },
              // Students only: teachers' test runs are not results.
              attempts: {
                where: { user: { role: "STUDENT" } },
                select: {
                  id: true,
                  userId: true,
                  status: true,
                  steps: {
                    where: { status: "PASSED" },
                    select: { stepId: true },
                  },
                  score: true,
                  scoreOverride: true,
                  feedback: true,
                  extraChecks: true,
                  checks: true,
                  hintsUsed: true,
                  resets: true,
                  startedAt: true,
                  finishedAt: true,
                  updatedAt: true,
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      lastLoginAt: true,
                    },
                  },
                  _count: { select: { commands: true } },
                  events: { select: { type: true, detail: true } },
                },
              },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });

      // ── rows ──
      const targetIds = a.groups.length
        ? new Set(a.groups.flatMap((g) => g.group.members.map((m) => m.userId)))
        : null;
      type Student = {
        id: string;
        name: string;
        email: string;
        lastLoginAt: Date | null;
      };
      const students = new Map<string, Student & { targeted: boolean }>();
      for (const m of a.class.memberships) {
        if (!targetIds || targetIds.has(m.user.id)) {
          students.set(m.user.id, { ...m.user, targeted: true });
        }
      }
      for (const item of a.items) {
        for (const att of item.attempts) {
          if (!students.has(att.userId)) {
            students.set(att.userId, { ...att.user, targeted: false });
          }
        }
      }
      const groupNamesOf = (userId: string) =>
        a.groups
          .filter((g) => g.group.members.some((m) => m.userId === userId))
          .map((g) => g.group.name);

      const items = a.items.map((i) => {
        const stepTotal = i.exercise.steps.reduce((n, st) => n + st.points, 0);
        return {
          id: i.id,
          title: i.exercise.title,
          slug: i.exercise.slug,
          exerciseId: i.exercise.id,
          points: itemPoints(i),
          stepCount: i.exercise._count.steps,
          steps: i.exercise.steps.map((st) => ({
            id: st.id,
            title: st.title,
            points: itemScore(st.points, stepTotal, i.points),
          })),
        };
      });
      const maxPoints = items.reduce((s, i) => s + i.points, 0);

      const rows = [...students.values()]
        .sort((x, y) => x.name.localeCompare(y.name, "de"))
        .map((s) => {
          const cells = a.items.map((i) => {
            const att = i.attempts.find((t) => t.userId === s.id);
            if (!att) return null;
            return {
              attemptId: att.id,
              status: att.status,
              score: att.score,
              stepsPassed: att.steps.length,
              passedStepIds: att.steps.map((st) => st.stepId),
              scoreOverridden: att.scoreOverride !== null,
              hasFeedback: !!att.feedback,
              extraChecks: att.extraChecks,
              checks: att.checks,
              hintsUsed: att.hintsUsed,
              resets: att.resets,
              commands: att._count.commands,
              pasteAttempts: pasteCount(
                att.events.filter((e) => e.type === "PASTE"),
              ),
              focusLost: att.events.filter((e) => e.type !== "PASTE").length,
              minutes: att.finishedAt
                ? Math.round(minutesBetween(att.startedAt, att.finishedAt))
                : null,
              lastActivity: att.updatedAt,
            };
          });
          const ext = a.extensions.find((e) => e.userId === s.id)?.extraMinutes;
          return {
            student: {
              id: s.id,
              name: s.name,
              email: s.email,
              lastLoginAt: s.lastLoginAt,
            },
            targeted: s.targeted,
            groups: groupNamesOf(s.id),
            extraMinutes: ext ?? null,
            submittedAt:
              a.submissions.find((x) => x.userId === s.id)?.submittedAt ?? null,
            cells,
            total: cells.reduce((sum, c) => sum + (c?.score ?? 0), 0),
            solved: cells.filter((c) => c?.status === "PASSED").length,
          };
        });

      // ── per-exercise stats ──
      const failing = await ctx.db.commandLog.findMany({
        where: {
          exitCode: { not: 0 },
          NOT: { exitCode: null },
          attempt: {
            assignmentItem: { assignmentId: a.id },
            user: { role: "STUDENT" },
          },
        },
        select: {
          command: true,
          attempt: { select: { assignmentItemId: true } },
        },
        take: 20_000,
      });
      const failingByItem = new Map<string, Map<string, number>>();
      for (const f of failing) {
        const key = f.command.trim().replace(/\s+/g, " ").slice(0, 120);
        const m =
          failingByItem.get(f.attempt.assignmentItemId) ??
          new Map<string, number>();
        m.set(key, (m.get(key) ?? 0) + 1);
        failingByItem.set(f.attempt.assignmentItemId, m);
      }

      // Figures are about the students the assignment is for; others (e.g.
      // moved to another group) still show in the table, but don't count.
      // Failing commands are collected from all attempts.
      const targetedIds = new Set(
        rows.filter((r) => r.targeted).map((r) => r.student.id),
      );
      const targetedCount = targetedIds.size;
      const stats = a.items.map((item) => {
        const i = {
          ...item,
          attempts: item.attempts.filter((t) => targetedIds.has(t.userId)),
        };
        const passed = i.attempts.filter((t) => t.status === "PASSED");
        const times = passed
          .filter((t) => t.finishedAt)
          .map((t) => minutesBetween(t.startedAt, t.finishedAt!));
        const top = [...(failingByItem.get(i.id)?.entries() ?? [])]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 5)
          .map(([command, count]) => ({ command, count }));
        return {
          itemId: i.id,
          started: i.attempts.length,
          passed: passed.length,
          passRate: targetedCount ? passed.length / targetedCount : 0,
          medianMinutes: median(times),
          avgChecksToPass: passed.length
            ? passed.reduce((s, t) => s + t.checks, 0) / passed.length
            : null,
          hintsUsed: i.attempts.reduce((s, t) => s + t.hintsUsed, 0),
          topFailing: top,
        };
      });

      return {
        assignment: {
          id: a.id,
          title: a.title,
          opensAt: a.opensAt,
          dueAt: a.dueAt,
          published: a.published,
          publishAt: a.publishAt,
          mode: a.mode,
          maxChecks: a.maxChecks,
          classId: a.class.id,
          className: a.class.name,
          groups: a.groups.map((g) => g.group.name),
        },
        items,
        maxPoints,
        rows,
        stats,
        summary: {
          students: targetedCount,
          started: rows.filter((r) => r.targeted && r.cells.some(Boolean))
            .length,
          fullySolved: rows.filter(
            (r) => r.targeted && r.solved === items.length && items.length > 0,
          ).length,
          avgPoints: targetedCount
            ? rows.filter((r) => r.targeted).reduce((s, r) => s + r.total, 0) /
              targetedCount
            : 0,
        },
      };
    }),

  /** One attempt with its full command history. */
  attempt: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const att = await ctx.db.attempt.findFirst({
        where: {
          id: input.id,
          assignmentItem: { assignment: assignmentWhere(ctx.user) },
        },
        select: {
          id: true,
          status: true,
          score: true,
          checks: true,
          hintsUsed: true,
          resets: true,
          extraChecks: true,
          scoreOverride: true,
          feedback: true,
          feedbackAt: true,
          checkOutput: true,
          startedAt: true,
          setupAt: true,
          finishedAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true, email: true } },
          assignmentItem: {
            select: {
              id: true,
              points: true,
              exercise: {
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  points: true,
                  steps: {
                    orderBy: { order: "asc" },
                    select: {
                      id: true,
                      title: true,
                      points: true,
                      hints: true,
                    },
                  },
                },
              },
              assignment: {
                select: {
                  id: true,
                  title: true,
                  dueAt: true,
                  mode: true,
                  maxChecks: true,
                  class: { select: { id: true, name: true } },
                  extensions: { select: { userId: true, extraMinutes: true } },
                  submissions: { select: { userId: true, submittedAt: true } },
                },
              },
            },
          },
          steps: true,
          commands: {
            orderBy: [{ at: "asc" }, { id: "asc" }],
            select: {
              id: true,
              at: true,
              exitCode: true,
              cwd: true,
              command: true,
            },
            take: 5000,
          },
          events: {
            orderBy: [{ at: "asc" }, { id: "asc" }],
            select: { id: true, at: true, type: true, detail: true },
            take: 2000,
          },
        },
      });
      if (!att) throw new TRPCError({ code: "NOT_FOUND" });
      const item = att.assignmentItem;
      const extra = item.assignment.extensions.find(
        (e) => e.userId === att.user.id,
      )?.extraMinutes;
      return {
        id: att.id,
        student: att.user,
        assignment: {
          id: item.assignment.id,
          title: item.assignment.title,
          className: item.assignment.class.name,
          classId: item.assignment.class.id,
          dueAt: effectiveDueAt(item.assignment.dueAt, extra),
          baseDueAt: item.assignment.dueAt,
          extraMinutes: extra ?? 0,
          mode: item.assignment.mode,
          maxChecks: item.assignment.maxChecks,
          submittedAt:
            item.assignment.submissions.find((x) => x.userId === att.user.id)
              ?.submittedAt ?? null,
        },
        exercise: {
          id: item.exercise.id,
          title: item.exercise.title,
          slug: item.exercise.slug,
          points: itemPoints(item),
          hintCount: item.exercise.steps.reduce(
            (s, st) => s + st.hints.length,
            0,
          ),
        },
        steps: item.exercise.steps.map((st, index) => {
          const p = att.steps.find((x) => x.stepId === st.id);
          const total = item.exercise.steps.reduce((s, x) => s + x.points, 0);
          return {
            id: st.id,
            index,
            title: st.title,
            points: itemScore(st.points, total, item.points),
            status: p?.status ?? null,
            checks: p?.checks ?? 0,
            hintsUsed: p?.hintsUsed ?? 0,
            hintCount: st.hints.length,
            passedAt: p?.passedAt ?? null,
            checkOutput: p?.checkOutput ?? null,
          };
        }),
        status: att.status,
        score: att.score,
        checks: att.checks,
        hintsUsed: att.hintsUsed,
        resets: att.resets,
        extraChecks: att.extraChecks,
        scoreOverride: att.scoreOverride,
        feedback: att.feedback,
        feedbackAt: att.feedbackAt,
        checkOutput: att.checkOutput,
        startedAt: att.startedAt,
        finishedAt: att.finishedAt,
        // Whichever is later: last change to the attempt or last command typed.
        lastActivity: new Date(
          Math.max(
            att.updatedAt.getTime(),
            att.commands.at(-1)?.at.getTime() ?? 0,
          ),
        ),
        minutes: att.finishedAt
          ? Math.round(minutesBetween(att.startedAt, att.finishedAt))
          : null,
        commands: att.commands.map((c) => ({
          id: c.id.toString(),
          at: c.at,
          exitCode: c.exitCode,
          cwd: shortCwd(c.cwd),
          command: c.command,
        })),
        focusEvents: att.events
          .filter((e) => e.type !== "PASTE")
          .map((e) => {
            let seconds: number | null = null;
            try {
              const d = JSON.parse(e.detail ?? "null") as {
                seconds?: unknown;
              } | null;
              if (typeof d?.seconds === "number") seconds = d.seconds;
            } catch {
              /* old / free-form detail */
            }
            return { id: e.id.toString(), at: e.at, type: e.type, seconds };
          }),
        pasteEvents: att.events
          .filter((e) => e.type === "PASTE")
          .map((e) => {
            const d = parsePasteDetail(e.detail);
            return {
              id: e.id.toString(),
              at: e.at,
              count: d?.count ?? 1,
              bytes: d?.bytes ?? 0,
              reasons: d?.reasons ?? {},
              terminal: d?.terminal ?? "",
            };
          }),
      };
    }),

  /** One student across all assignments of a class. */
  student: teacherProcedure
    .input(z.object({ userId: z.string(), classId: z.string() }))
    .query(async ({ ctx, input }) => {
      const cls = await ctx.db.class.findFirst({
        where: { AND: [{ id: input.classId }, classWhere(ctx.user)] },
        select: { id: true, name: true },
      });
      if (!cls) throw new TRPCError({ code: "NOT_FOUND" });
      const user = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          name: true,
          email: true,
          lastLoginAt: true,
          memberships: {
            where: { classId: cls.id },
            select: { classId: true },
          },
          classGroups: {
            where: { group: { classId: cls.id } },
            select: { group: { select: { name: true } } },
          },
        },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const assignments = await ctx.db.assignment.findMany({
        where: { classId: cls.id },
        orderBy: [
          { dueAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
        ],
        select: {
          id: true,
          title: true,
          dueAt: true,
          published: true,
          groups: {
            select: {
              group: {
                select: {
                  members: {
                    where: { userId: user.id },
                    select: { userId: true },
                  },
                },
              },
            },
          },
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              points: true,
              exercise: { select: { title: true, points: true } },
              attempts: {
                where: { userId: user.id },
                select: {
                  id: true,
                  status: true,
                  score: true,
                  checks: true,
                  hintsUsed: true,
                  resets: true,
                  startedAt: true,
                  finishedAt: true,
                  _count: { select: { commands: true } },
                  events: pasteEventsSelect,
                },
              },
            },
          },
        },
      });

      const list = assignments
        .map((a) => {
          const targeted =
            a.groups.length === 0 ||
            a.groups.some((g) => g.group.members.length > 0);
          const items = a.items.map((i) => {
            const t = i.attempts[0];
            return {
              itemId: i.id,
              title: i.exercise.title,
              points: itemPoints(i),
              attempt: t
                ? {
                    id: t.id,
                    status: t.status,
                    score: t.score,
                    checks: t.checks,
                    hintsUsed: t.hintsUsed,
                    resets: t.resets,
                    commands: t._count.commands,
                    pasteAttempts: pasteCount(t.events),
                    minutes: t.finishedAt
                      ? Math.round(minutesBetween(t.startedAt, t.finishedAt))
                      : null,
                  }
                : null,
            };
          });
          return {
            id: a.id,
            title: a.title,
            dueAt: a.dueAt,
            published: a.published,
            targeted,
            items,
            total: items.reduce((s, i) => s + (i.attempt?.score ?? 0), 0),
            maxPoints: items.reduce((s, i) => s + i.points, 0),
          };
        })
        .filter((a) => a.targeted || a.items.some((i) => i.attempt));

      // Only students who are (or were, via attempts) in this class: a
      // teacher must not look up arbitrary users through their own class.
      const hasAttempts = list.some((a) => a.items.some((i) => i.attempt));
      if (user.memberships.length === 0 && !hasAttempts) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        class: cls,
        student: {
          id: user.id,
          name: user.name,
          email: user.email,
          lastLoginAt: user.lastLoginAt,
          inClass: user.memberships.length > 0,
          groups: user.classGroups.map((g) => g.group.name),
        },
        assignments: list,
        total: list.reduce((s, a) => s + a.total, 0),
        maxPoints: list.reduce((s, a) => s + a.maxPoints, 0),
      };
    }),
});
