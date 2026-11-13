import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assignmentWhere, classWhere, isAdmin } from "~/server/access";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";
import { ingestCommandLog } from "~/server/assignments/command-log";
import { parsePasteDetail } from "~/server/assignments/paste-events";
import { recomputeAttemptById } from "~/server/assignments/recompute";
import { itemMaxPoints } from "~/server/assignments/scoring";
import { type db as Db } from "~/server/db";
import { HOME } from "~/server/exercises/run";
import { runner } from "~/server/runner";

/**
 * Teacher actions on students: extra time, extra checks, resetting an
 * attempt, manual points, feedback, reopening a handed-in exam,
 * announcements, the live view and watching a terminal.
 *
 * Access: same as reports — assignments of classes the caller teaches
 * (admins: all).
 */

type Ctx = { db: typeof Db; user: { id: string; role: string } };

async function loadAssignment(ctx: Ctx, id: string) {
  const a = await ctx.db.assignment.findFirst({
    where: { AND: [{ id }, assignmentWhere(ctx.user)] },
    select: { id: true, classId: true },
  });
  if (!a) throw new TRPCError({ code: "NOT_FOUND" });
  return a;
}

async function loadAttempt(ctx: Ctx, id: string) {
  const att = await ctx.db.attempt.findFirst({
    where: {
      id,
      assignmentItem: { assignment: assignmentWhere(ctx.user) },
    },
    select: {
      id: true,
      userId: true,
      assignmentItem: {
        select: {
          points: true,
          exercise: { select: { points: true } },
        },
      },
    },
  });
  if (!att) throw new TRPCError({ code: "NOT_FOUND" });
  return att;
}

/** Is `userId` a student of a class the caller teaches (admins: anyone)? */
async function assertMyStudent(ctx: Ctx, userId: string, classId?: string) {
  if (isAdmin(ctx.user) && !classId) return;
  const m = await ctx.db.classMembership.findFirst({
    where: {
      userId,
      ...(classId ? { classId } : {}),
      class: classWhere(ctx.user),
    },
    select: { userId: true },
  });
  if (!m) throw new TRPCError({ code: "NOT_FOUND" });
}

// Command logs are pulled from boxes at most this often per student.
const SYNC_EVERY_MS = 15_000;
const lastSync = new Map<string, number>();

async function mapLimit<T>(
  xs: T[],
  limit: number,
  fn: (x: T) => Promise<unknown>,
) {
  const queue = [...xs];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) {
        await fn(x);
      }
    }),
  );
}

/** Open terminals per student (empty when the runner is unreachable). */
async function terminalsByUser() {
  try {
    const { sessions } = await runner.sessions();
    return new Map(sessions.map((s) => [s.userId, s]));
  } catch {
    return new Map<
      string,
      Awaited<ReturnType<typeof runner.sessions>>["sessions"][number]
    >();
  }
}

const IDLE_MINUTES = 10;
const STUCK_CHECKS = 3;
const STUCK_FAILED_COMMANDS = 5;

export const manageRouter = createTRPCRouter({
  /** Extra minutes for one student (0 removes the extension). */
  setExtension: teacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        userId: z.string(),
        extraMinutes: z
          .number()
          .int()
          .min(0)
          .max(60 * 24 * 60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const a = await loadAssignment(ctx, input.assignmentId);
      await assertMyStudent(ctx, input.userId, a.classId);
      const key = {
        assignmentId_userId: {
          assignmentId: a.id,
          userId: input.userId,
        },
      };
      if (input.extraMinutes === 0) {
        await ctx.db.assignmentExtension.deleteMany({
          where: { assignmentId: a.id, userId: input.userId },
        });
      } else {
        await ctx.db.assignmentExtension.upsert({
          where: key,
          create: {
            assignmentId: a.id,
            userId: input.userId,
            extraMinutes: input.extraMinutes,
          },
          update: { extraMinutes: input.extraMinutes },
        });
      }
    }),

  /** Extra checks per step on top of the assignment's limit. */
  setExtraChecks: teacherProcedure
    .input(
      z.object({
        attemptId: z.string(),
        extraChecks: z.number().int().min(0).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const att = await loadAttempt(ctx, input.attemptId);
      await ctx.db.attempt.update({
        where: { id: att.id },
        data: { extraChecks: input.extraChecks },
      });
    }),

  /**
   * Delete an attempt (progress, command log, events). The student starts
   * over: the next open runs the setup again, which wipes their folder.
   */
  resetAttempt: teacherProcedure
    .input(z.object({ attemptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const att = await loadAttempt(ctx, input.attemptId);
      await ctx.db.attempt.delete({ where: { id: att.id } });
    }),

  /** Manual points (null = back to the computed score). */
  setScore: teacherProcedure
    .input(
      z.object({
        attemptId: z.string(),
        score: z.number().int().min(0).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const att = await loadAttempt(ctx, input.attemptId);
      const max = itemMaxPoints(
        att.assignmentItem.points,
        att.assignmentItem.exercise.points,
      );
      if (input.score !== null && input.score > max) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `At most ${max} points.`,
        });
      }
      await ctx.db.attempt.update({
        where: { id: att.id },
        data: { scoreOverride: input.score },
      });
      await recomputeAttemptById(ctx.db, att.id);
    }),

  /** Note to the student, shown on the exercise page ("" removes it). */
  setFeedback: teacherProcedure
    .input(z.object({ attemptId: z.string(), text: z.string().max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const att = await loadAttempt(ctx, input.attemptId);
      const text = input.text.trim();
      await ctx.db.attempt.update({
        where: { id: att.id },
        data: text
          ? { feedback: text, feedbackAt: new Date() }
          : { feedback: null, feedbackAt: null },
      });
    }),

  /** Exam: let a student who handed in continue. */
  reopenSubmission: teacherProcedure
    .input(z.object({ assignmentId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const a = await loadAssignment(ctx, input.assignmentId);
      await ctx.db.assignmentSubmission.deleteMany({
        where: { assignmentId: a.id, userId: input.userId },
      });
    }),

  announcements: teacherProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await loadAssignment(ctx, input.assignmentId);
      return ctx.db.announcement.findMany({
        where: { assignmentId: a.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          text: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      });
    }),

  /** Message to everyone working on the assignment (shown as a banner). */
  announce: teacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        text: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const a = await loadAssignment(ctx, input.assignmentId);
      await ctx.db.announcement.create({
        data: { assignmentId: a.id, authorId: ctx.user.id, text: input.text },
      });
    }),

  deleteAnnouncement: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const n = await ctx.db.announcement.findFirst({
        where: { id: input.id, assignment: assignmentWhere(ctx.user) },
        select: { id: true },
      });
      if (!n) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.announcement.delete({ where: { id: n.id } });
    }),

  /**
   * Token to watch a student's terminal read-only. The student sees that
   * someone is watching.
   */
  watch: teacherProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertMyStudent(ctx, input.userId);
      const student = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { id: true, name: true },
      });
      return { ...(await runner.watchInfo(student.id)), name: student.name };
    }),

  /**
   * Pull fresh command logs out of the boxes of students who have a
   * terminal open (throttled per student). Called by the live view.
   */
  syncCommands: teacherProcedure
    .input(z.object({ assignmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const a = await loadAssignment(ctx, input.assignmentId);
      const members = await ctx.db.classMembership.findMany({
        where: { classId: a.classId, user: { role: "STUDENT" } },
        select: { userId: true },
      });
      const open = await terminalsByUser();
      const now = Date.now();
      const due = members
        .map((m) => m.userId)
        .filter(
          (id) =>
            open.has(id) && now - (lastSync.get(id) ?? 0) >= SYNC_EVERY_MS,
        );
      due.forEach((id) => lastSync.set(id, now));
      let commands = 0;
      await mapLimit(due, 6, async (id) => {
        commands += await ingestCommandLog(id);
      });
      return { students: due.length, commands };
    }),

  /** Everything the live view shows, one row per targeted student. */
  live: teacherProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        select: {
          id: true,
          title: true,
          mode: true,
          opensAt: true,
          dueAt: true,
          maxChecks: true,
          class: {
            select: {
              id: true,
              name: true,
              memberships: {
                where: { user: { role: "STUDENT" } },
                select: { user: { select: { id: true, name: true } } },
              },
            },
          },
          groups: {
            select: { group: { select: { members: true } } },
          },
          extensions: { select: { userId: true, extraMinutes: true } },
          submissions: { select: { userId: true, submittedAt: true } },
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              points: true,
              exercise: {
                select: {
                  title: true,
                  slug: true,
                  points: true,
                  steps: {
                    orderBy: { order: "asc" },
                    select: { id: true, title: true },
                  },
                },
              },
              attempts: {
                where: { user: { role: "STUDENT" } },
                select: {
                  id: true,
                  userId: true,
                  status: true,
                  score: true,
                  updatedAt: true,
                  steps: {
                    select: { stepId: true, status: true, checks: true },
                  },
                  events: { select: { type: true, detail: true } },
                },
              },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });

      const targetIds = a.groups.length
        ? new Set(a.groups.flatMap((g) => g.group.members.map((m) => m.userId)))
        : null;
      const students = a.class.memberships
        .map((m) => m.user)
        .filter((u) => !targetIds || targetIds.has(u.id))
        .sort((x, y) => x.name.localeCompare(y.name, "de"));

      const attemptIds = a.items.flatMap((i) => i.attempts.map((t) => t.id));
      const since = new Date(Date.now() - IDLE_MINUTES * 60_000);
      const [lastCommands, recentFailed, open] = await Promise.all([
        // Newest command per attempt.
        attemptIds.length
          ? ctx.db.commandLog.findMany({
              where: { attemptId: { in: attemptIds } },
              orderBy: [{ attemptId: "asc" }, { at: "desc" }, { id: "desc" }],
              distinct: ["attemptId"],
              select: {
                attemptId: true,
                at: true,
                command: true,
                exitCode: true,
              },
            })
          : [],
        attemptIds.length
          ? ctx.db.commandLog.groupBy({
              by: ["attemptId"],
              where: {
                attemptId: { in: attemptIds },
                at: { gte: since },
                exitCode: { not: 0 },
                NOT: { exitCode: null },
              },
              _count: { _all: true },
            })
          : [],
        terminalsByUser(),
      ]);
      const lastByAttempt = new Map(lastCommands.map((c) => [c.attemptId, c]));
      const failedByAttempt = new Map(
        recentFailed.map((r) => [r.attemptId, r._count._all]),
      );
      const now = Date.now();

      const rows = students.map((s) => {
        const items = a.items.map((it) => {
          const att = it.attempts.find((t) => t.userId === s.id) ?? null;
          const passed = new Set(
            att?.steps
              .filter((st) => st.status === "PASSED")
              .map((st) => st.stepId) ?? [],
          );
          return { it, att, passed };
        });
        // The exercise the student is on: newest activity.
        const activity = (x: (typeof items)[number]) =>
          Math.max(
            x.att?.updatedAt.getTime() ?? 0,
            (x.att && lastByAttempt.get(x.att.id)?.at.getTime()) ?? 0,
          );
        const current = items
          .filter((x) => x.att)
          .sort((x, y) => activity(y) - activity(x))[0];
        const currentStep = current
          ? current.it.exercise.steps.find((st) => !current.passed.has(st.id))
          : undefined;
        const currentStepChecks = current?.att?.steps.find(
          (st) => st.stepId === currentStep?.id,
        )?.checks;
        const last = current?.att ? lastByAttempt.get(current.att.id) : null;
        const term = open.get(s.id);
        const lastActivity = Math.max(
          current ? activity(current) : 0,
          term?.lastActivity ?? 0,
        );
        const failedRecently = items.reduce(
          (n, x) => n + ((x.att && failedByAttempt.get(x.att.id)) ?? 0),
          0,
        );
        const focusLost = items.reduce(
          (n, x) =>
            n + (x.att?.events.filter((e) => e.type !== "PASTE").length ?? 0),
          0,
        );
        const pasteAttempts = items.reduce(
          (n, x) =>
            n +
            (x.att?.events
              .filter((e) => e.type === "PASTE")
              .reduce(
                (m, e) => m + (parsePasteDetail(e.detail)?.count ?? 1),
                0,
              ) ?? 0),
          0,
        );
        const solved = items.filter((x) => x.att?.status === "PASSED").length;
        const submitted =
          a.submissions.find((x) => x.userId === s.id)?.submittedAt ?? null;
        const stuck =
          !submitted &&
          !!currentStep &&
          ((currentStepChecks ?? 0) >= STUCK_CHECKS ||
            failedRecently >= STUCK_FAILED_COMMANDS);
        const idle =
          !submitted &&
          solved < a.items.length &&
          lastActivity > 0 &&
          now - lastActivity > IDLE_MINUTES * 60_000;
        return {
          student: s,
          online: !!term,
          watchers: term?.watchers ?? 0,
          cwd: term?.cwd?.startsWith(HOME)
            ? `~${term.cwd.slice(HOME.length)}`
            : (term?.cwd ?? null),
          lastActivity: lastActivity ? new Date(lastActivity) : null,
          submitted,
          extraMinutes:
            a.extensions.find((e) => e.userId === s.id)?.extraMinutes ?? null,
          current: current
            ? {
                itemId: current.it.id,
                attemptId: current.att!.id,
                title: current.it.exercise.title,
                step: currentStep
                  ? {
                      index: current.it.exercise.steps.indexOf(currentStep),
                      count: current.it.exercise.steps.length,
                      title: currentStep.title,
                      checks: currentStepChecks ?? 0,
                    }
                  : null,
              }
            : null,
          lastCommand: last
            ? { command: last.command, exitCode: last.exitCode, at: last.at }
            : null,
          items: items.map((x) => ({
            itemId: x.it.id,
            attemptId: x.att?.id ?? null,
            status: x.att?.status ?? null,
            stepsPassed: x.passed.size,
            stepCount: x.it.exercise.steps.length,
          })),
          score: items.reduce((n, x) => n + (x.att?.score ?? 0), 0),
          solved,
          failedRecently,
          focusLost,
          pasteAttempts,
          flags: { stuck, idle },
        };
      });

      return {
        assignment: {
          id: a.id,
          title: a.title,
          mode: a.mode,
          opensAt: a.opensAt,
          dueAt: a.dueAt,
          maxChecks: a.maxChecks,
          classId: a.class.id,
          className: a.class.name,
        },
        items: a.items.map((i) => ({
          id: i.id,
          title: i.exercise.title,
          points: itemMaxPoints(i.points, i.exercise.points),
        })),
        maxPoints: a.items.reduce(
          (n, i) => n + itemMaxPoints(i.points, i.exercise.points),
          0,
        ),
        rows,
        summary: {
          students: rows.length,
          online: rows.filter((r) => r.online).length,
          stuck: rows.filter((r) => r.flags.stuck).length,
          idle: rows.filter((r) => r.flags.idle).length,
          submitted: rows.filter((r) => r.submitted).length,
          allSolved: rows.filter(
            (r) => a.items.length > 0 && r.solved === a.items.length,
          ).length,
        },
        runnerReachable: open.size > 0 || (await runnerUp()),
        at: new Date(),
      };
    }),
});

async function runnerUp() {
  try {
    await runner.sessions();
    return true;
  } catch {
    return false;
  }
}
