import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ingestCommandLog } from "~/server/assignments/command-log";
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
 */

type Db = typeof dbType;

const itemPoints = (item: {
  points: number | null;
  exercise: { points: number };
}) => item.points ?? item.exercise.points;

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
          hints: true,
          setupScript: true,
          checkScript: true,
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
      attempts: { where: { userId } },
    },
  });
  if (!item) throw new TRPCError({ code: "NOT_FOUND" });
  const extra = item.assignment.extensions[0]?.extraMinutes;
  const state = windowState(item.assignment, extra);
  return { item, attempt: item.attempts[0] ?? null, state, extra };
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
                },
              },
              attempts: {
                where: { userId },
                select: { status: true, score: true, checks: true },
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
      const { item, attempt, state, extra } = await loadItem(
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
      const hintsUsed = attempt?.hintsUsed ?? 0;
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
          hintCount: item.exercise.hints.length,
        },
        attempt: attempt && {
          status: attempt.status,
          score: attempt.score,
          checks: attempt.checks,
          resets: attempt.resets,
          prepared: attempt.setupAt !== null,
          lastCheckOutput: attempt.checkOutput,
          revealedHints: item.assignment.allowHints
            ? item.exercise.hints.slice(0, hintsUsed)
            : [],
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

  /** Run the check script against my folder. */
  check: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { item, attempt, state } = await loadItem(
        ctx.db,
        userId,
        input.itemId,
      );
      assertOpen(state);
      if (!attempt?.setupAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Open the exercise first.",
        });
      }
      // Claim a check atomically BEFORE running it, so parallel requests
      // can't get past maxChecks (the limit doesn't apply once solved).
      const max = item.assignment.maxChecks;
      const claim = await ctx.db.attempt.updateMany({
        where: {
          id: attempt.id,
          ...(max !== null
            ? { OR: [{ status: "PASSED" }, { checks: { lt: max } }] }
            : {}),
        },
        data: { checks: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `No checks left (${max} allowed).`,
        });
      }
      // Store commands up to now before checking (keeps the log in order).
      await ingestCommandLog(userId);
      let res;
      try {
        res = await guardRunner(() => runCheck(userId, item.exercise));
      } catch (e) {
        // The check never ran: give the claimed check back.
        await ctx.db.attempt.update({
          where: { id: attempt.id },
          data: { checks: { decrement: 1 } },
        });
        throw e;
      }
      if (res.ok) {
        // Only the first passing check awards points (conditional update).
        await ctx.db.attempt.updateMany({
          where: { id: attempt.id, status: { not: "PASSED" } },
          data: {
            status: "PASSED",
            score: itemPoints(item),
            finishedAt: new Date(),
          },
        });
      }
      const updated = await ctx.db.attempt.update({
        where: { id: attempt.id },
        data: { checkOutput: res.output.slice(0, 8000) },
      });
      return {
        ok: res.ok,
        output: res.output,
        timedOut: res.timedOut,
        status: updated.status,
        score: updated.score,
        checks: updated.checks,
      };
    }),

  /** Reveal the next hint. */
  hint: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { item, attempt, state } = await loadItem(
        ctx.db,
        userId,
        input.itemId,
      );
      assertOpen(state);
      if (!item.assignment.allowHints) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Hints are turned off for this assignment.",
        });
      }
      if (!attempt)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Open the exercise first.",
        });
      if (attempt.hintsUsed >= item.exercise.hints.length) {
        return { revealedHints: item.exercise.hints };
      }
      const updated = await ctx.db.attempt.update({
        where: { id: attempt.id },
        data: { hintsUsed: { increment: 1 } },
      });
      return { revealedHints: item.exercise.hints.slice(0, updated.hintsUsed) };
    }),

  /** Wipe my exercise folder and run the setup again. Points already earned stay. */
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
      if (!attempt)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Open the exercise first.",
        });
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
