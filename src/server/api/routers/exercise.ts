import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { exerciseInput, totalPoints, type StepInput } from "~/lib/exercise";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";
import { type db } from "~/server/db";
import { exerciseDir, runCheck, runSetup } from "~/server/exercises/run";
import type { Prisma } from "../../../../generated/prisma";

type Viewer = { id: string; role: string };

/** Teachers see their own + shared exercises; admins see everything. */
const readableWhere = (u: Viewer): Prisma.ExerciseWhereInput =>
  u.role === "ADMIN"
    ? {}
    : { OR: [{ authorId: u.id }, { visibility: "SHARED" }] };

const canEdit = (u: Viewer, ex: { authorId: string }) =>
  u.role === "ADMIN" || ex.authorId === u.id;

const isUniqueViolation = (e: unknown) =>
  (e as { code?: string }).code === "P2002";

const slugTaken = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "This slug is already used by another exercise.",
  });

/** Step columns from the form (order = position in the list). */
const stepData = (s: StepInput, order: number) => ({
  order,
  title: s.title,
  description: s.description,
  checkScript: s.checkScript,
  hints: s.hints,
  points: s.points,
  requiresPrevious: s.requiresPrevious,
});

export const exerciseRouter = createTRPCRouter({
  list: teacherProcedure
    .input(
      z
        .object({
          q: z.string().trim().max(100).optional(),
          shell: z.enum(["BASH", "PWSH"]).optional(),
          mine: z.boolean().optional(),
          archived: z.boolean().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.exercise.findMany({
        where: {
          AND: [
            readableWhere(ctx.user),
            { archived: input.archived ?? false },
            input.shell ? { shell: input.shell } : {},
            input.mine ? { authorId: ctx.user.id } : {},
            input.q
              ? {
                  OR: [
                    { title: { contains: input.q, mode: "insensitive" } },
                    { slug: { contains: input.q.toLowerCase() } },
                    { tags: { has: input.q.toLowerCase() } },
                  ],
                }
              : {},
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          shell: true,
          difficulty: true,
          points: true,
          tags: true,
          visibility: true,
          archived: true,
          updatedAt: true,
          authorId: true,
          author: { select: { name: true } },
          _count: { select: { steps: true } },
        },
      });
      return rows.map(({ _count, ...r }) => ({
        ...r,
        stepCount: _count.steps,
      }));
    }),

  byId: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const ex = await ctx.db.exercise.findFirst({
        where: { AND: [{ id: input.id }, readableWhere(ctx.user)] },
        include: {
          author: { select: { name: true } },
          steps: {
            orderBy: { order: "asc" },
            include: { _count: { select: { attemptSteps: true } } },
          },
        },
      });
      if (!ex) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...ex,
        steps: ex.steps.map(({ _count, ...s }) => ({
          ...s,
          attemptCount: _count.attemptSteps,
        })),
        canEdit: canEdit(ctx.user, ex),
      };
    }),

  create: teacherProcedure
    .input(exerciseInput)
    .mutation(async ({ ctx, input }) => {
      const { steps, ...fields } = input;
      try {
        return await ctx.db.exercise.create({
          data: {
            ...fields,
            points: totalPoints(steps),
            authorId: ctx.user.id,
            steps: { create: steps.map((s, i) => stepData(s, i)) },
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw slugTaken();
        throw e;
      }
    }),

  /**
   * Save the exercise and its steps. Steps are matched by `id`: existing
   * ones are updated (their student progress stays), new ones created,
   * missing ones deleted (their AttemptStep rows cascade).
   */
  update: teacherProcedure
    .input(z.object({ id: z.string(), data: exerciseInput }))
    .mutation(async ({ ctx, input }) => {
      const ex = await ctx.db.exercise.findUnique({
        where: { id: input.id },
        select: { authorId: true, steps: { select: { id: true } } },
      });
      if (!ex) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canEdit(ctx.user, ex)) throw new TRPCError({ code: "FORBIDDEN" });

      const { steps, ...fields } = input.data;
      const existing = new Set(ex.steps.map((s) => s.id));
      const keptIds = new Set<string>();
      for (const s of steps) {
        if (!s.id) continue;
        if (!existing.has(s.id) || keptIds.has(s.id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A step does not belong to this exercise.",
          });
        }
        keptIds.add(s.id);
      }
      const removed = [...existing].filter((id) => !keptIds.has(id));

      try {
        const [updated, , ...savedSteps] = await ctx.db.$transaction([
          ctx.db.exercise.update({
            where: { id: input.id },
            data: { ...fields, points: totalPoints(steps) },
            select: { id: true, updatedAt: true },
          }),
          ctx.db.exerciseStep.deleteMany({
            where: { exerciseId: input.id, id: { in: removed } },
          }),
          ...steps.map((s, i) =>
            s.id
              ? ctx.db.exerciseStep.update({
                  where: { id: s.id },
                  data: stepData(s, i),
                })
              : ctx.db.exerciseStep.create({
                  data: { ...stepData(s, i), exerciseId: input.id },
                }),
          ),
        ]);
        // Step ids in form order, so the editor can keep new steps' ids.
        return { ...updated, stepIds: savedSteps.map((s) => s.id) };
      } catch (e) {
        if (isUniqueViolation(e)) throw slugTaken();
        throw e;
      }
    }),

  setArchived: teacherProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const ex = await ctx.db.exercise.findUnique({
        where: { id: input.id },
        select: { authorId: true },
      });
      if (!ex) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canEdit(ctx.user, ex)) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.db.exercise.update({
        where: { id: input.id },
        data: { archived: input.archived },
      });
    }),

  /** Copy any readable exercise (with its steps) into a new private one. */
  duplicate: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const src = await ctx.db.exercise.findFirst({
        where: { AND: [{ id: input.id }, readableWhere(ctx.user)] },
        include: { steps: { orderBy: { order: "asc" } } },
      });
      if (!src) throw new TRPCError({ code: "NOT_FOUND" });

      const base = `${src.slug}-copy`.slice(0, 55);
      const taken = new Set(
        (
          await ctx.db.exercise.findMany({
            where: { slug: { startsWith: base } },
            select: { slug: true },
          })
        ).map((e) => e.slug),
      );
      let slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

      return ctx.db.exercise.create({
        data: {
          title: `${src.title} (copy)`,
          slug,
          description: src.description,
          shell: src.shell,
          difficulty: src.difficulty,
          points: src.points,
          setupScript: src.setupScript,
          tags: src.tags,
          visibility: "PRIVATE",
          authorId: ctx.user.id,
          steps: {
            create: src.steps.map((s, i) => ({
              order: i,
              title: s.title,
              description: s.description,
              checkScript: s.checkScript,
              hints: s.hints,
              points: s.points,
              requiresPrevious: s.requiresPrevious,
            })),
          },
        },
        select: { id: true },
      });
    }),

  /**
   * Teacher test run, in the teacher's OWN box: wipe the exercise folder and
   * run the saved setup script (once for all steps).
   */
  testSetup: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ex = await loadForRun(ctx, input.id);
      const result = await guardRunner(() => runSetup(ctx.user.id, ex));
      return { ...result, dir: exerciseDir(ex.slug) };
    }),

  /** Teacher test run: run one step's saved check script against the folder. */
  testCheck: teacherProcedure
    .input(z.object({ id: z.string(), stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ex = await loadForRun(ctx, input.id);
      const step = await ctx.db.exerciseStep.findFirst({
        where: { id: input.stepId, exerciseId: input.id },
        select: { checkScript: true },
      });
      if (!step) throw new TRPCError({ code: "NOT_FOUND" });
      return guardRunner(() =>
        runCheck(ctx.user.id, {
          slug: ex.slug,
          shell: ex.shell,
          checkScript: step.checkScript,
        }),
      );
    }),
});

async function loadForRun(ctx: { db: typeof db; user: Viewer }, id: string) {
  const ex = await ctx.db.exercise.findFirst({
    where: { AND: [{ id }, readableWhere(ctx.user)] },
    select: { slug: true, shell: true, setupScript: true },
  });
  if (!ex) throw new TRPCError({ code: "NOT_FOUND" });
  return ex;
}

async function guardRunner<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    console.error("[exercise] runner call failed", e);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The shell runner is not reachable or could not start the box. Is the runner running and the image built?",
    });
  }
}
