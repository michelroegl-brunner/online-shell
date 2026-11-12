import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ingestCommandLog } from "~/server/assignments/command-log";
import {
  itemMaxPoints,
  itemScore,
  stepUnlocked,
} from "~/server/assignments/scoring";
import { assignmentWhereVisibleTo } from "~/server/assignments/visibility";
import {
  effectiveDueAt,
  windowState,
  type WindowState,
} from "~/server/assignments/window";
import { type db as dbType } from "~/server/db";
import { runCheck, runSetup } from "~/server/exercises/run";

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

/** Load an assignment item the caller may work on, or throw NOT_FOUND. */
async function loadItem(db: Db, userId: string, itemId: string) {
  const item = await db.assignmentItem.findFirst({
    where: { id: itemId, assignment: assignmentWhereVisibleTo(userId) },
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
          class: { select: { name: true } },
          extensions: { where: { userId }, select: { extraMinutes: true } },
          items: { orderBy: { order: "asc" }, select: { id: true } },
        },
      },
      attempts: { where: { userId }, include: { steps: true } },
    },
  });
  if (!item) throw new TRPCError({ code: "NOT_FOUND" });
  const extra = item.assignment.extensions[0]?.extraMinutes;
  const state = windowState(item.assignment, extra);
  const attempt = item.attempts[0] ?? null;

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
  return { item, attempt, state, extra, steps };
}

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

/** Recompute the attempt totals from its step rows. */
async function recomputeAttempt(
  db: Db,
  attemptId: string,
  steps: { id: string; points: number }[],
  override: number | null,
) {
  const rows = await db.attemptStep.findMany({ where: { attemptId } });
  const byId = new Map(rows.map((r) => [r.stepId, r]));
  const earned = steps.reduce(
    (s, st) => s + (byId.get(st.id)?.status === "PASSED" ? st.points : 0),
    0,
  );
  const total = steps.reduce((s, st) => s + st.points, 0);
  const allPassed =
    steps.length > 0 &&
    steps.every((st) => byId.get(st.id)?.status === "PASSED");
  const anyPassed = earned > 0 || rows.some((r) => r.status === "PASSED");
  const current = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: { finishedAt: true },
  });
  return db.attempt.update({
    where: { id: attemptId },
    data: {
      status: allPassed ? "PASSED" : "IN_PROGRESS",
      score: anyPassed ? itemScore(earned, total, override) : null,
      checks: rows.reduce((s, r) => s + r.checks, 0),
      hintsUsed: rows.reduce((s, r) => s + r.hintsUsed, 0),
      finishedAt: allPassed ? (current.finishedAt ?? new Date()) : null,
    },
  });
}

export const learnRouter = createTRPCRouter({
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
        extensions: { where: { userId }, select: { extraMinutes: true } },
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
            state: windowState(a, extra),
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
      const a = await ctx.db.assignment.findFirst({
        where: { id: input.id, ...assignmentWhereVisibleTo(userId) },
        select: {
          id: true,
          title: true,
          opensAt: true,
          dueAt: true,
          maxChecks: true,
          allowHints: true,
          class: { select: { name: true } },
          extensions: { where: { userId }, select: { extraMinutes: true } },
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
      if (windowState(a, extra) === "upcoming") {
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
        state: windowState(a, extra),
        maxChecks: a.maxChecks,
        allowHints: a.allowHints,
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
      const { item, attempt, state, extra, steps } = await loadItem(
        ctx.db,
        ctx.user.id,
        input.itemId,
      );
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
        assignment: {
          id: item.assignment.id,
          title: item.assignment.title,
          className: item.assignment.class.name,
          dueAt: effectiveDueAt(item.assignment.dueAt, extra),
          state,
          maxChecks: item.assignment.maxChecks,
          allowHints: item.assignment.allowHints,
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
          lastCheckOutput: s.progress?.checkOutput ?? null,
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
        userId,
        input.itemId,
      );
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
      const loaded = await loadItem(ctx.db, userId, input.itemId);
      const { item, attempt, state } = loaded;
      assertOpen(state);
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
      const max = item.assignment.maxChecks;
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
        res = await guardRunner(() =>
          runCheck(userId, {
            slug: item.exercise.slug,
            shell: item.exercise.shell,
            checkScript: step.checkScript,
          }),
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
        output: res.output,
        timedOut: res.timedOut,
        exerciseSolved: updated.status === "PASSED",
        score: updated.score,
      };
    }),

  /** Reveal the next hint of a step. */
  hint: protectedProcedure
    .input(z.object({ itemId: z.string(), stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const loaded = await loadItem(ctx.db, userId, input.itemId);
      const { item, attempt, state } = loaded;
      assertOpen(state);
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
        userId,
        input.itemId,
      );
      assertOpen(state);
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
});
