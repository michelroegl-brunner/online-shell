import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { exerciseInput } from "~/lib/exercise";
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
    .query(({ ctx, input }) =>
      ctx.db.exercise.findMany({
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
        },
      }),
    ),

  byId: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const ex = await ctx.db.exercise.findFirst({
        where: { AND: [{ id: input.id }, readableWhere(ctx.user)] },
        include: { author: { select: { name: true } } },
      });
      if (!ex) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...ex, canEdit: canEdit(ctx.user, ex) };
    }),

  create: teacherProcedure
    .input(exerciseInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.exercise.create({
          data: { ...input, authorId: ctx.user.id },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw slugTaken();
        throw e;
      }
    }),

  update: teacherProcedure
    .input(z.object({ id: z.string(), data: exerciseInput }))
    .mutation(async ({ ctx, input }) => {
      const ex = await ctx.db.exercise.findUnique({
        where: { id: input.id },
        select: { authorId: true },
      });
      if (!ex) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canEdit(ctx.user, ex)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        return await ctx.db.exercise.update({
          where: { id: input.id },
          data: input.data,
          select: { id: true, updatedAt: true },
        });
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

  /** Copy any readable exercise into a new private one owned by the caller. */
  duplicate: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const src = await ctx.db.exercise.findFirst({
        where: { AND: [{ id: input.id }, readableWhere(ctx.user)] },
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
          checkScript: src.checkScript,
          hints: src.hints,
          tags: src.tags,
          visibility: "PRIVATE",
          authorId: ctx.user.id,
        },
        select: { id: true },
      });
    }),

  /**
   * Teacher test run, in the teacher's OWN box: wipe the exercise folder and
   * run the saved setup script.
   */
  testSetup: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ex = await loadForRun(ctx, input.id);
      const result = await guardRunner(() => runSetup(ctx.user.id, ex));
      return { ...result, dir: exerciseDir(ex.slug) };
    }),

  /** Teacher test run: run the saved check script against the folder. */
  testCheck: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ex = await loadForRun(ctx, input.id);
      return guardRunner(() => runCheck(ctx.user.id, ex));
    }),
});

async function loadForRun(ctx: { db: typeof db; user: Viewer }, id: string) {
  const ex = await ctx.db.exercise.findFirst({
    where: { AND: [{ id }, readableWhere(ctx.user)] },
    select: { slug: true, shell: true, setupScript: true, checkScript: true },
  });
  if (!ex) throw new TRPCError({ code: "NOT_FOUND" });
  return ex;
}

async function guardRunner<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error("[exercise] runner call failed", e);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The shell runner is not reachable or could not start the box. Is the runner running and the image built?",
    });
  }
}
