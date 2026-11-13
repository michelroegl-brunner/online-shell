import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseChecks } from "~/lib/checks";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ingestCommandLog } from "~/server/assignments/command-log";
import { EXAM_EVENT_TYPES, openExamsFor } from "~/server/assignments/exam";
import { studentProgress } from "~/server/assignments/progress";
import { recomputeAttempt } from "~/server/assignments/recompute";
import {
  itemMaxPoints,
  itemScore,
  stepUnlocked,
} from "~/server/assignments/scoring";
import { assignmentWhere, isAdmin } from "~/server/access";
import { assignmentWhereVisibleTo } from "~/server/assignments/visibility";
import {
  effectiveDueAt,
  windowState,
  type WindowState,
} from "~/server/assignments/window";
import { type db as dbType } from "~/server/db";
import { runStepChecks } from "~/server/exercises/checks";
import { runSetup } from "~/server/exercises/run";
import type { Prisma } from "../../../../generated/prisma";

/**
 * Student side of assignments. Everything is scoped to assignments visible
 * to the caller (published, their class, their groups). Setup/check scripts
 * never leave the server.
 *
 * Exercises have 1..n steps sharing one folder. Progress is stored per step
 * (AttemptStep); the Attempt row holds the totals (status, score, checks,
 * hintsUsed) so lists and reports stay simple.
 */

type Db = typeof dbType;

const itemPoints = (item: {
  points: number | null;
  exercise: { points: number };
}) => itemMaxPoints(item.points, item.exercise.points);

type Viewer = { id: string; role: string };

/**
 * Assignments the caller may open: students see what's visible to them;
 * teachers additionally see every assignment of the classes they teach
 * (admins: all) for a **test run**.
 */
function learnWhere(user: Viewer): Prisma.AssignmentWhereInput {
  if (user.role === "STUDENT") return assignmentWhereVisibleTo(user.id);
  // Admins reach everything. Don't put assignmentWhere()'s `{}` into an OR:
  // Prisma drops empty filters there, leaving only the student rule (404).
  if (isAdmin(user)) return {};
  return { OR: [assignmentWhereVisibleTo(user.id), assignmentWhere(user)] };
}

/**
 * Teachers always work in test-run mode: no time window, drafts allowed,
 * and their attempts are left out of reports.
 */
const isPreview = (user: Viewer) => user.role !== "STUDENT";

/** Load an assignment item the caller may work on, or throw NOT_FOUND. */
async function loadItem(db: Db, user: Viewer, itemId: string) {
  const userId = user.id;
  const item = await db.assignmentItem.findFirst({
    where: { id: itemId, assignment: learnWhere(user) },
    select: {
      id: true,
      order: true,
      points: true,
      exercise: {
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          shell: true,
          difficulty: true,
          points: true,
          setupScript: true,
          steps: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              description: true,
              checkScript: true,
              checks: true,
              hints: true,
              points: true,
              requiresPrevious: true,
            },
          },
        },
      },
      assignment: {
        select: {
          id: true,
          title: true,
          opensAt: true,
          dueAt: true,
          maxChecks: true,
          allowHints: true,
          mode: true,
          class: { select: { name: true } },
          extensions: { where: { userId }, select: { extraMinutes: true } },
          submissions: { where: { userId }, select: { submittedAt: true } },
          items: { orderBy: { order: "asc" }, select: { id: true } },
        },
      },
      attempts: { where: { userId }, include: { steps: true } },
    },
  });
  if (!item) throw new TRPCError({ code: "NOT_FOUND" });
  const extra = item.assignment.extensions[0]?.extraMinutes;
  const preview = isPreview(user);
  const submitted = item.assignment.submissions[0]?.submittedAt ?? null;
  const state: WindowState = preview
    ? "open"
    : submitted
      ? "closed"
      : windowState(item.assignment, extra);
  const attempt = item.attempts[0] ?? null;
  const exam = item.assignment.mode === "EXAM";
  // Checks per step: the assignment's limit plus what a teacher granted.
  const maxChecks =
    item.assignment.maxChecks === null
      ? null
      : item.assignment.maxChecks + (attempt?.extraChecks ?? 0);

  // Step states (unlock depends on the previous step's progress).
  const progress = new Map((attempt?.steps ?? []).map((s) => [s.stepId, s]));
  const steps = item.exercise.steps.map((s, index, all) => {
    const prev = index > 0 ? progress.get(all[index - 1]!.id) : undefined;
    const p = progress.get(s.id) ?? null;
    return {
      ...s,
      index,
      progress: p,
      unlocked: stepUnlocked(
        index,
        s.requiresPrevious,
        prev?.status === "PASSED",
      ),
    };
  });
  return {
    item,
    attempt,
    state,
    extra,
    steps,
    preview,
    exam,
    submitted,
    maxChecks,
  };
}

/** While an exam is running for a student, only that exam is available. */
async function assertNotLockedByExam(
  db: Db,
  user: Viewer,
  assignmentId: string,
) {
  const exams = await openExamsFor(db, user);
  if (exams.length > 0 && !exams.some((e) => e.id === assignmentId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `The exam "${exams[0]!.title}" is running — only its exercises are available until you hand it in.`,
    });
  }
}

const HIDDEN_OUTPUT_PASSED = "Check passed.";
const HIDDEN_OUTPUT_FAILED = "Not solved yet. (Exam: check output is hidden.)";

type Loaded = Awaited<ReturnType<typeof loadItem>>;

function findStep(loaded: Loaded, stepId: string) {
  const step = loaded.steps.find((s) => s.id === stepId);
  if (!step)
    throw new TRPCError({ code: "NOT_FOUND", message: "Step not found." });
  if (!step.unlocked) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solve the previous step first.",
    });
  }
  return step;
}

function assertOpen(state: WindowState) {
  if (state === "upcoming") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This assignment hasn't started yet.",
    });
  }
  if (state === "closed") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This assignment is closed.",
    });
  }
}

async function guardRunner<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    console.error("[learn] runner call failed", e);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Your shell could not be started right now. Please try again in a moment or tell your teacher.",
    });
  }
}

export const learnRouter = createTRPCRouter({
  /**
   * Teacher test run: delete my attempts for this assignment so it starts
   * fresh (the next open runs the setups again).
   */
  resetPreview: protectedProcedure
    .input(z.object({ assignmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!isPreview(ctx.user)) throw new TRPCError({ code: "FORBIDDEN" });
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        select: { id: true },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      const { count } = await ctx.db.attempt.deleteMany({
        where: { userId: ctx.user.id, assignmentItem: { assignmentId: a.id } },
      });
      return { deleted: count };
    }),

  /** My classes with their visible assignments and my progress. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const assignments = await ctx.db.assignment.findMany({
      where: assignmentWhereVisibleTo(userId),
      orderBy: [
        { dueAt: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        title: true,
        opensAt: true,
        dueAt: true,
        classId: true,
        mode: true,
        extensions: { where: { userId }, select: { extraMinutes: true } },
        submissions: { where: { userId }, select: { submittedAt: true } },
        items: {
          select: {
            points: true,
            exercise: { select: { points: true } },
            attempts: {
              where: { userId },
              select: { status: true, score: true },
            },
          },
        },
      },
    });
    const classes = await ctx.db.class.findMany({
      where: { archived: false, memberships: { some: { userId } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return classes.map((c) => ({
      ...c,
      assignments: assignments
        .filter((a) => a.classId === c.id)
        .map((a) => {
          const extra = a.extensions[0]?.extraMinutes;
          return {
            id: a.id,
            title: a.title,
            opensAt: a.opensAt,
            dueAt: effectiveDueAt(a.dueAt, extra),
            state: a.submissions.length
              ? ("closed" as const)
              : windowState(a, extra),
            mode: a.mode,
            submitted: a.submissions.length > 0,
            total: a.items.length,
            solved: a.items.filter((i) => i.attempts[0]?.status === "PASSED")
              .length,
            points: a.items.reduce(
              (s, i) => s + (i.attempts[0]?.score ?? 0),
              0,
            ),
            maxPoints: a.items.reduce((s, i) => s + itemPoints(i), 0),
          };
        }),
    }));
  }),

  /** One assignment with its exercises and my status per exercise. */
  assignment: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const preview = isPreview(ctx.user);
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.id }, learnWhere(ctx.user)] },
        select: {
          id: true,
          title: true,
          opensAt: true,
          dueAt: true,
          maxChecks: true,
          allowHints: true,
          published: true,
          mode: true,
          class: { select: { name: true } },
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
                  difficulty: true,
                  points: true,
                  tags: true,
                  _count: { select: { steps: true } },
                },
              },
              attempts: {
                where: { userId },
                select: {
                  status: true,
                  score: true,
                  checks: true,
                  steps: {
                    where: { status: "PASSED" },
                    select: { stepId: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      const extra = a.extensions[0]?.extraMinutes;
      const submittedAt = a.submissions[0]?.submittedAt ?? null;
      const state: WindowState = preview
        ? "open"
        : submittedAt
          ? "closed"
          : windowState(a, extra);
      if (state === "upcoming") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This assignment hasn't started yet.",
        });
      }
      return {
        id: a.id,
        title: a.title,
        className: a.class.name,
        opensAt: a.opensAt,
        dueAt: effectiveDueAt(a.dueAt, extra),
        state,
        /** Teacher test run: not counted, no time window. */
        preview,
        published: a.published,
        maxChecks: a.maxChecks,
        allowHints: a.allowHints,
        mode: a.mode,
        submittedAt,
        items: a.items.map((i) => ({
          id: i.id,
          title: i.exercise.title,
          shell: i.exercise.shell,
          difficulty: i.exercise.difficulty,
          tags: i.exercise.tags,
          points: itemPoints(i),
          stepCount: i.exercise._count.steps,
          stepsPassed: i.attempts[0]?.steps.length ?? 0,
          status: i.attempts[0]?.status ?? null,
          score: i.attempts[0]?.score ?? null,
          checks: i.attempts[0]?.checks ?? 0,
        })),
      };
    }),

  /** Everything the exercise page needs (no scripts). Does not start anything. */
  item: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const {
        item,
        attempt,
        state,
        extra,
        steps,
        preview,
        exam,
        submitted,
        maxChecks,
      } = await loadItem(ctx.db, ctx.user, input.itemId);
      // During an exam, other assignments' tasks and revealed hints stay
      // hidden too (not just their actions).
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      // Task text stays hidden until the assignment opens (enforced here,
      // not only by the page).
      if (state === "upcoming") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This assignment hasn't started yet.",
        });
      }
      const ids = item.assignment.items.map((i) => i.id);
      const idx = ids.indexOf(item.id);
      const total = steps.reduce((s, st) => s + st.points, 0);
      const scale = (p: number) => itemScore(p, total, item.points);
      return {
        itemId: item.id,
        preview,
        assignment: {
          id: item.assignment.id,
          title: item.assignment.title,
          className: item.assignment.class.name,
          dueAt: effectiveDueAt(item.assignment.dueAt, extra),
          state,
          maxChecks,
          allowHints: item.assignment.allowHints,
          mode: item.assignment.mode,
          submittedAt: submitted,
        },
        position: {
          index: idx,
          total: ids.length,
          prev: ids[idx - 1] ?? null,
          next: ids[idx + 1] ?? null,
        },
        exercise: {
          slug: item.exercise.slug,
          title: item.exercise.title,
          description: item.exercise.description,
          shell: item.exercise.shell,
          difficulty: item.exercise.difficulty,
          points: itemPoints(item),
        },
        // Locked steps only reveal their title.
        steps: steps.map((s) => ({
          id: s.id,
          index: s.index,
          title: s.title,
          unlocked: s.unlocked,
          requiresPrevious: s.requiresPrevious,
          description: s.unlocked ? s.description : null,
          points: scale(s.points),
          hintCount: s.unlocked ? s.hints.length : 0,
          status: s.progress?.status ?? null,
          score: s.progress?.status === "PASSED" ? scale(s.points) : null,
          checks: s.progress?.checks ?? 0,
          lastCheckOutput:
            s.progress?.checkOutput == null
              ? null
              : exam
                ? s.progress.status === "PASSED"
                  ? HIDDEN_OUTPUT_PASSED
                  : HIDDEN_OUTPUT_FAILED
                : s.progress.checkOutput,
          revealedHints:
            s.unlocked && item.assignment.allowHints
              ? s.hints.slice(0, s.progress?.hintsUsed ?? 0)
              : [],
        })),
        attempt: attempt && {
          status: attempt.status,
          score: attempt.score,
          checks: attempt.checks,
          resets: attempt.resets,
          prepared: attempt.setupAt !== null,
          feedback: attempt.feedback,
          feedbackAt: attempt.feedbackAt,
          scoreOverridden: attempt.scoreOverride !== null,
        },
      };
    }),

  /**
   * Open the exercise: create my attempt and prepare its folder in my box
   * (setup runs only the first time; use `reset` to start over).
   */
  start: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { item, attempt, state } = await loadItem(
        ctx.db,
        ctx.user,
        input.itemId,
      );
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      if (attempt?.setupAt) {
        await ingestCommandLog(userId);
        // Touch updatedAt so command-log attribution prefers this attempt.
        await ctx.db.attempt.update({
          where: { id: attempt.id },
          data: { updatedAt: new Date() },
        });
        return { prepared: true, setupOk: true, output: "" };
      }
      assertOpen(state);
      const att = await ctx.db.attempt.upsert({
        where: {
          userId_assignmentItemId: { userId, assignmentItemId: item.id },
        },
        create: { userId, assignmentItemId: item.id },
        update: {},
      });
      const res = await guardRunner(() => runSetup(userId, item.exercise));
      if (res.ok) {
        await ctx.db.attempt.update({
          where: { id: att.id },
          data: { setupAt: new Date() },
        });
      } else {
        console.error(
          `[learn] setup failed for ${item.exercise.slug}: ${res.output}`,
        );
      }
      return {
        prepared: res.ok,
        setupOk: res.ok,
        output: res.ok
          ? ""
          : "Preparing this exercise failed. Please tell your teacher.",
      };
    }),

  /** Run one step's check script against my folder. */
  check: protectedProcedure
    .input(z.object({ itemId: z.string(), stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const loaded = await loadItem(ctx.db, ctx.user, input.itemId);
      const { item, attempt, state, exam } = loaded;
      assertOpen(state);
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      if (!attempt?.setupAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Open the exercise first.",
        });
      }
      const step = findStep(loaded, input.stepId);
      const key = {
        attemptId_stepId: { attemptId: attempt.id, stepId: step.id },
      };
      await ctx.db.attemptStep.upsert({
        where: key,
        create: { attemptId: attempt.id, stepId: step.id },
        update: {},
      });

      // Claim a check atomically BEFORE running it, so parallel requests
      // can't get past maxChecks (per step; no limit once the step passed).
      const max = loaded.maxChecks;
      const claim = await ctx.db.attemptStep.updateMany({
        where: {
          attemptId: attempt.id,
          stepId: step.id,
          ...(max !== null
            ? { OR: [{ status: "PASSED" }, { checks: { lt: max } }] }
            : {}),
        },
        data: { checks: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `No checks left for this step (${max} allowed).`,
        });
      }
      // Store commands up to now before checking (keeps the log in order).
      await ingestCommandLog(userId);
      let res;
      try {
        const checks = parseChecks(step.checks);
        const commands = checks.some((c) => c.type === "command_used")
          ? await ctx.db.commandLog.findMany({
              where: { attemptId: attempt.id },
              select: { command: true, exitCode: true },
            })
          : [];
        res = await guardRunner(() =>
          runStepChecks(
            userId,
            { slug: item.exercise.slug, shell: item.exercise.shell },
            { checkScript: step.checkScript, checks },
            commands,
          ),
        );
      } catch (e) {
        // The check never ran: give the claimed check back.
        await ctx.db.attemptStep.update({
          where: key,
          data: { checks: { decrement: 1 } },
        });
        throw e;
      }
      if (res.ok) {
        // Only the first passing check awards the step (conditional update).
        await ctx.db.attemptStep.updateMany({
          where: {
            attemptId: attempt.id,
            stepId: step.id,
            status: { not: "PASSED" },
          },
          data: { status: "PASSED", score: step.points, passedAt: new Date() },
        });
      }
      await ctx.db.attemptStep.update({
        where: key,
        data: { checkOutput: res.output.slice(0, 8000) },
      });
      await ctx.db.attempt.update({
        where: { id: attempt.id },
        data: { checkOutput: res.output.slice(0, 8000) },
      });
      const updated = await recomputeAttempt(
        ctx.db,
        attempt.id,
        item.exercise.steps,
        item.points,
      );
      return {
        ok: res.ok,
        output: exam
          ? res.ok
            ? HIDDEN_OUTPUT_PASSED
            : HIDDEN_OUTPUT_FAILED
          : res.output,
        timedOut: res.timedOut,
        exerciseSolved: updated.status === "PASSED",
        score: updated.score,
      };
    }),

  /** Reveal the next hint of a step. */
  hint: protectedProcedure
    .input(z.object({ itemId: z.string(), stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const loaded = await loadItem(ctx.db, ctx.user, input.itemId);
      const { item, attempt, state } = loaded;
      assertOpen(state);
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      if (!item.assignment.allowHints) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Hints are turned off for this assignment.",
        });
      }
      if (!attempt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Open the exercise first.",
        });
      }
      const step = findStep(loaded, input.stepId);
      const key = {
        attemptId_stepId: { attemptId: attempt.id, stepId: step.id },
      };
      const row = await ctx.db.attemptStep.upsert({
        where: key,
        create: { attemptId: attempt.id, stepId: step.id },
        update: {},
      });
      if (row.hintsUsed >= step.hints.length) {
        return { revealedHints: step.hints };
      }
      const updated = await ctx.db.attemptStep.update({
        where: key,
        data: { hintsUsed: { increment: 1 } },
      });
      await recomputeAttempt(
        ctx.db,
        attempt.id,
        item.exercise.steps,
        item.points,
      );
      return { revealedHints: step.hints.slice(0, updated.hintsUsed) };
    }),

  /**
   * Wipe my exercise folder and run the setup again (all steps share it).
   * Points of solved steps stay.
   */
  reset: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { item, attempt, state } = await loadItem(
        ctx.db,
        ctx.user,
        input.itemId,
      );
      assertOpen(state);
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      if (!attempt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Open the exercise first.",
        });
      }
      await ingestCommandLog(userId);
      const res = await guardRunner(() => runSetup(userId, item.exercise));
      await ctx.db.attempt.update({
        where: { id: attempt.id },
        data: {
          resets: { increment: 1 },
          ...(res.ok ? { setupAt: new Date() } : {}),
        },
      });
      return {
        ok: res.ok,
        output: res.ok ? "" : "Resetting failed. Please tell your teacher.",
      };
    }),
  /**
   * Exam: hand in. Stores the last commands, then closes the assignment for
   * me (a teacher can reopen it).
   */
  submit: protectedProcedure
    .input(z.object({ assignmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (isPreview(ctx.user)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Test runs can not be handed in.",
        });
      }
      const a = await ctx.db.assignment.findFirst({
        where: {
          AND: [
            { id: input.assignmentId },
            assignmentWhereVisibleTo(ctx.user.id),
            { mode: "EXAM" },
          ],
        },
        select: { id: true },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      await ingestCommandLog(ctx.user.id);
      await ctx.db.assignmentSubmission.upsert({
        where: {
          assignmentId_userId: { assignmentId: a.id, userId: ctx.user.id },
        },
        create: { assignmentId: a.id, userId: ctx.user.id },
        update: {},
      });
      return { ok: true };
    }),

  /**
   * Exam: the page lost focus / was hidden / left fullscreen. Stored on my
   * attempt for the teacher. Capped per attempt so a flapping window can't
   * flood the table.
   */
  examEvent: protectedProcedure
    .input(
      z.object({
        itemId: z.string(),
        type: z.enum(EXAM_EVENT_TYPES),
        /** Seconds away (sent when focus comes back), if known. */
        seconds: z.number().int().min(0).max(86_400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isPreview(ctx.user)) return { stored: false };
      const att = await ctx.db.attempt.findFirst({
        where: {
          userId: ctx.user.id,
          assignmentItemId: input.itemId,
          assignmentItem: { assignment: { mode: "EXAM" } },
        },
        select: { id: true, _count: { select: { events: true } } },
      });
      if (!att || att._count.events >= 2000) return { stored: false };
      await ctx.db.examEvent.create({
        data: {
          attemptId: att.id,
          type: input.type,
          detail:
            input.seconds === undefined
              ? null
              : JSON.stringify({ seconds: input.seconds }),
        },
      });
      return { stored: true };
    }),

  /** Teacher messages for an assignment I can open (newest first). */
  announcements: protectedProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, learnWhere(ctx.user)] },
        select: {
          announcements: {
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              text: true,
              createdAt: true,
              author: { select: { name: true } },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      return a.announcements.map((n) => ({
        id: n.id,
        text: n.text,
        createdAt: n.createdAt,
        author: n.author.name,
      }));
    }),

  /** My points over time, results per tag and weak topics to practise. */
  progress: protectedProcedure.query(({ ctx }) =>
    studentProgress(ctx.db, ctx.user.id),
  ),

  /** Is an exam running for me (locks the playground and other work)? */
  examLock: protectedProcedure.query(async ({ ctx }) => {
    const exams = await openExamsFor(ctx.db, ctx.user);
    return exams[0] ? { id: exams[0].id, title: exams[0].title } : null;
  }),
});
