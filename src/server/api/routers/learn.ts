import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseChecks } from "~/lib/checks";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ingestCommandLog } from "~/server/assignments/command-log";
import { EXAM_EVENT_TYPES, openExamsFor } from "~/server/assignments/exam";
import { studentProgress } from "~/server/assignments/progress";
import { recomputeAttempt } from "~/server/assignments/recompute";
import {
  type ExerciseKind,
  gateLocks,
  isLesson,
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
import { runSetup, type RunResult } from "~/server/exercises/run";
import { type ShellKind } from "~/server/runner";
import type { Prisma } from "../../../../generated/prisma";

/**
 * Student side of assignments. Everything is scoped to assignments visible
 * to the caller (published, their class, their groups). Setup/check scripts
 * never leave the server.
 *
 * Exercises have 1..n steps sharing one folder. Progress is stored per step
 * (AttemptStep); the Attempt row holds the totals (status, score, checks,
 * hintsUsed) so lists and reports stay simple.
 *
 * Lessons (Exercise.kind = LESSON) are ungraded walkthroughs: 0 points, no
 * check limit, and the page calls `autoCheck` after each command so a step
 * passes by itself. Gates (AssignmentItem.gate) lock the items after an
 * unsolved gated item for students (teachers' test runs ignore them).
 */

type Db = typeof dbType;

const itemPoints = (item: {
  points: number | null;
  exercise: { points: number; kind: ExerciseKind };
}) => itemMaxPoints(item.points, item.exercise.points, item.exercise.kind);

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
          kind: true,
          tags: true,
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
          allowCheatSheet: true,
          mode: true,
          class: { select: { name: true } },
          extensions: { where: { userId }, select: { extraMinutes: true } },
          submissions: { where: { userId }, select: { submittedAt: true } },
          // For navigation and gates (my status on every item).
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              gate: true,
              exercise: { select: { title: true } },
              attempts: { where: { userId }, select: { status: true } },
            },
          },
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
  const lesson = isLesson(item.exercise.kind);
  // Checks per step: the assignment's limit plus what a teacher granted.
  // Lessons have no limit (they check themselves after every command).
  const maxChecks =
    lesson || item.assignment.maxChecks === null
      ? null
      : item.assignment.maxChecks + (attempt?.extraChecks ?? 0);

  // Gates: title of the unsolved gated item that keeps this one (or the
  // next one) locked. Test runs ignore gates.
  const order = item.assignment.items;
  const locks = gateLocks(
    order.map((i) => ({
      gate: i.gate,
      title: i.exercise.title,
      passed: i.attempts[0]?.status === "PASSED",
    })),
  );
  const idx = order.findIndex((i) => i.id === item.id);
  const lockedBy = preview ? null : (locks[idx] ?? null);
  const nextLockedBy = preview ? null : (locks[idx + 1] ?? null);

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
    lesson,
    submitted,
    maxChecks,
    lockedBy,
    nextLockedBy,
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

/** Items after an unsolved gated item stay locked for students. */
function assertNotGated(loaded: Loaded) {
  if (loaded.lockedBy) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Finish “${loaded.lockedBy}” first — this exercise unlocks after it.`,
    });
  }
}

/**
 * Run one step's checks (ready-made + script) against my folder. Stores
 * the commands so far first, so "command used" sees the latest ones.
 */
async function runChecksFor(
  db: Db,
  userId: string,
  attemptId: string,
  ex: { slug: string; shell: ShellKind },
  step: { checkScript: string; checks: unknown },
): Promise<RunResult> {
  await ingestCommandLog(userId);
  const checks = parseChecks(step.checks);
  const commands = checks.some((c) => c.type === "command_used")
    ? await db.commandLog.findMany({
        where: { attemptId },
        select: { command: true, exitCode: true },
      })
    : [];
  return guardRunner(() =>
    runStepChecks(
      userId,
      ex,
      { checkScript: step.checkScript, checks },
      commands,
    ),
  );
}

/** Only the first passing check awards the step (conditional update). */
async function markStepPassed(
  db: Db,
  attemptId: string,
  step: { id: string; points: number },
) {
  await db.attemptStep.updateMany({
    where: { attemptId, stepId: step.id, status: { not: "PASSED" } },
    data: { status: "PASSED", score: step.points, passedAt: new Date() },
  });
}

/**
 * Students with an auto-check running (this server process). Auto-checks
 * fire after every command, so overlapping ones are skipped, not queued.
 */
const autoChecking = new Set<string>();

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
            exercise: { select: { points: true, kind: true } },
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
            // Lessons never add points (even with a manual score).
            points: a.items.reduce(
              (s, i) =>
                s +
                (isLesson(i.exercise.kind) ? 0 : (i.attempts[0]?.score ?? 0)),
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
              gate: true,
              exercise: {
                select: {
                  title: true,
                  shell: true,
                  kind: true,
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
      const locks = gateLocks(
        a.items.map((i) => ({
          gate: i.gate,
          title: i.exercise.title,
          passed: i.attempts[0]?.status === "PASSED",
        })),
      );
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
        items: a.items.map((i, idx) => ({
          id: i.id,
          title: i.exercise.title,
          shell: i.exercise.shell,
          kind: i.exercise.kind,
          difficulty: i.exercise.difficulty,
          tags: i.exercise.tags,
          /** Later items stay locked until this one is solved. */
          gate: i.gate,
          /** Title of the gated item to finish first (null = open). */
          lockedBy: preview ? null : (locks[idx] ?? null),
          points: itemPoints(i),
          stepCount: i.exercise._count.steps,
          stepsPassed: i.attempts[0]?.steps.length ?? 0,
          status: i.attempts[0]?.status ?? null,
          score: isLesson(i.exercise.kind)
            ? null
            : (i.attempts[0]?.score ?? null),
          checks: i.attempts[0]?.checks ?? 0,
        })),
      };
    }),

  /** Everything the exercise page needs (no scripts). Does not start anything. */
  item: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const loaded = await loadItem(ctx.db, ctx.user, input.itemId);
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
        nextLockedBy,
      } = loaded;
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
      assertNotGated(loaded);
      const ids = item.assignment.items.map((i) => i.id);
      const idx = ids.indexOf(item.id);
      const total = steps.reduce((s, st) => s + st.points, 0);
      const scale = (p: number) =>
        itemScore(p, total, item.points, item.exercise.kind);
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
          allowCheatSheet: item.assignment.allowCheatSheet,
          mode: item.assignment.mode,
          submittedAt: submitted,
        },
        position: {
          index: idx,
          total: ids.length,
          prev: ids[idx - 1] ?? null,
          next: ids[idx + 1] ?? null,
          /** The next item is locked until this gated one is solved. */
          nextLockedBy,
        },
        exercise: {
          id: item.exercise.id,
          kind: item.exercise.kind,
          tags: item.exercise.tags,
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
          score: isLesson(item.exercise.kind) ? 0 : attempt.score,
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
      const loaded = await loadItem(ctx.db, ctx.user, input.itemId);
      const { item, attempt, state } = loaded;
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      assertNotGated(loaded);
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
      assertNotGated(loaded);
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
      // can't get past maxChecks (per step; no limit once the step passed;
      // lessons have none).
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
      let res;
      try {
        res = await runChecksFor(
          ctx.db,
          userId,
          attempt.id,
          { slug: item.exercise.slug, shell: item.exercise.shell },
          step,
        );
      } catch (e) {
        // The check never ran: give the claimed check back.
        await ctx.db.attemptStep.update({
          where: key,
          data: { checks: { decrement: 1 } },
        });
        throw e;
      }
      if (res.ok) await markStepPassed(ctx.db, attempt.id, step);
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

  /**
   * Lessons only: check the current step (or `stepId`) quietly after the
   * student ran a command. Doesn't count as a check and stores nothing
   * when it fails (no output, no check count), so the page stays calm;
   * when it passes, the step is solved like with `check`.
   */
  autoCheck: protectedProcedure
    .input(z.object({ itemId: z.string(), stepId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const loaded = await loadItem(ctx.db, ctx.user, input.itemId);
      const { item, attempt, state, exam, lesson } = loaded;
      if (!lesson) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only lessons check themselves.",
        });
      }
      assertOpen(state);
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      assertNotGated(loaded);
      const idle = { ran: false, ok: false, stepId: null, output: "" };
      if (!attempt?.setupAt) return { ...idle, exerciseSolved: false };
      const step = input.stepId
        ? findStep(loaded, input.stepId)
        : loaded.steps.find(
            (s) => s.unlocked && s.progress?.status !== "PASSED",
          );
      const solved = attempt.status === "PASSED";
      if (!step || step.progress?.status === "PASSED") {
        return { ...idle, exerciseSolved: solved };
      }
      if (autoChecking.has(userId)) return { ...idle, exerciseSolved: solved };
      autoChecking.add(userId);
      let res: RunResult;
      try {
        res = await runChecksFor(
          ctx.db,
          userId,
          attempt.id,
          { slug: item.exercise.slug, shell: item.exercise.shell },
          step,
        );
      } finally {
        autoChecking.delete(userId);
      }
      if (!res.ok) {
        return { ...idle, ran: true, stepId: step.id, exerciseSolved: solved };
      }

      const key = {
        attemptId_stepId: { attemptId: attempt.id, stepId: step.id },
      };
      await ctx.db.attemptStep.upsert({
        where: key,
        create: { attemptId: attempt.id, stepId: step.id },
        update: {},
      });
      await markStepPassed(ctx.db, attempt.id, step);
      // The passing run counts as the step's one check (for reports).
      await ctx.db.attemptStep.update({
        where: key,
        data: {
          checks: { increment: 1 },
          checkOutput: res.output.slice(0, 8000),
        },
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
        ran: true,
        ok: true,
        stepId: step.id,
        output: exam ? HIDDEN_OUTPUT_PASSED : res.output,
        exerciseSolved: updated.status === "PASSED",
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
      assertNotGated(loaded);
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
      const loaded = await loadItem(ctx.db, ctx.user, input.itemId);
      const { item, attempt, state } = loaded;
      assertOpen(state);
      await assertNotLockedByExam(ctx.db, ctx.user, item.assignment.id);
      assertNotGated(loaded);
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
