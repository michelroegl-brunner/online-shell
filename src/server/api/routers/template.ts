import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  assignmentWhere,
  exerciseReadableWhere,
  isAdmin,
  templateEditableWhere,
  templateReadableWhere,
} from "~/server/access";
import {
  assignmentInput,
  createAssignment,
  type Ctx,
} from "~/server/api/routers/assignment";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";

/**
 * Assignment templates: exercises + settings without class or dates.
 * "Use" turns one into a real assignment for a class/groups and a window.
 *
 * Access: own templates (admins: all) are editable; SHARED ones of other
 * teachers can be used and copied. Exercises follow the exercise router's
 * readability rule (own or SHARED), checked on save and again on use.
 */

const templateInput = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().max(5000).default(""),
    mode: z.enum(["PRACTICE", "EXAM"]).default("PRACTICE"),
    maxChecks: z.number().int().min(1).max(1000).nullable().optional(),
    allowHints: z.boolean().default(true),
    hintPenalty: z.number().int().min(0).max(100).default(0),
    allowCheatSheet: z.boolean().default(true),
    allowPaste: z.boolean().default(false),
    durationMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 60)
      .nullable()
      .optional(),
    visibility: z.enum(["PRIVATE", "SHARED"]).default("PRIVATE"),
    items: z
      .array(
        z.object({
          exerciseId: z.string().min(1),
          points: z.number().int().min(0).max(1000).nullable().optional(),
          gate: z.boolean().default(false),
        }),
      )
      .max(100),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.exerciseId)).size === v.items.length,
    { message: "An exercise can only be added once.", path: ["items"] },
  );

type TemplateInput = z.infer<typeof templateInput>;

async function assertExercises(ctx: Ctx, ids: string[]) {
  if (!ids.length) return;
  const found = await ctx.db.exercise.count({
    where: { AND: [{ id: { in: ids } }, exerciseReadableWhere(ctx.user)] },
  });
  if (found !== new Set(ids).size) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An exercise is missing or not available to you.",
    });
  }
}

async function loadEditable(ctx: Ctx, id: string) {
  const t = await ctx.db.assignmentTemplate.findFirst({
    where: { AND: [{ id }, templateEditableWhere(ctx.user)] },
    select: { id: true },
  });
  if (!t) throw new TRPCError({ code: "NOT_FOUND" });
}

const baseData = (input: TemplateInput) => ({
  title: input.title,
  description: input.description,
  mode: input.mode,
  maxChecks: input.maxChecks ?? null,
  allowHints: input.allowHints,
  hintPenalty: input.hintPenalty,
  allowCheatSheet: input.allowCheatSheet,
  allowPaste: input.allowPaste,
  durationMinutes: input.durationMinutes ?? null,
  visibility: input.visibility,
});

const itemsCreate = (input: TemplateInput) =>
  input.items.map((it, order) => ({
    exerciseId: it.exerciseId,
    order,
    points: it.points ?? null,
    gate: it.gate,
  }));

export const templateRouter = createTRPCRouter({
  /** My templates plus shared ones, with exercise count and points. */
  list: teacherProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.assignmentTemplate.findMany({
      where: templateReadableWhere(ctx.user),
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        description: true,
        mode: true,
        durationMinutes: true,
        visibility: true,
        updatedAt: true,
        ownerId: true,
        owner: { select: { name: true } },
        _count: { select: { items: true } },
        // Shared templates may hold another teacher's private exercises:
        // those are left out here (counted in `hidden`).
        items: {
          where: { exercise: exerciseReadableWhere(ctx.user) },
          orderBy: { order: "asc" },
          select: {
            points: true,
            exercise: {
              select: { title: true, shell: true, points: true, kind: true },
            },
          },
        },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      mode: t.mode,
      durationMinutes: t.durationMinutes,
      visibility: t.visibility,
      updatedAt: t.updatedAt,
      owner: t.owner.name,
      mine: t.ownerId === ctx.user.id,
      canEdit: t.ownerId === ctx.user.id || isAdmin(ctx.user),
      hidden: t._count.items - t.items.length,
      exercises: t.items.map((i) => ({
        title: i.exercise.title,
        shell: i.exercise.shell,
      })),
      points: t.items.reduce((s, i) => s + (i.points ?? i.exercise.points), 0),
    }));
  }),

  byId: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.db.assignmentTemplate.findFirst({
        where: { AND: [{ id: input.id }, templateReadableWhere(ctx.user)] },
        include: {
          owner: { select: { name: true } },
          _count: { select: { items: true } },
          // Same as list: no details of exercises the caller can't read.
          items: {
            where: { exercise: exerciseReadableWhere(ctx.user) },
            orderBy: { order: "asc" },
            select: {
              points: true,
              gate: true,
              exercise: {
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  shell: true,
                  kind: true,
                  points: true,
                },
              },
            },
          },
        },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const { _count, ...rest } = t;
      return {
        ...rest,
        hidden: _count.items - t.items.length,
        canEdit: t.ownerId === ctx.user.id || isAdmin(ctx.user),
      };
    }),

  create: teacherProcedure
    .input(templateInput)
    .mutation(async ({ ctx, input }) => {
      await assertExercises(
        ctx,
        input.items.map((i) => i.exerciseId),
      );
      return ctx.db.assignmentTemplate.create({
        data: {
          ...baseData(input),
          ownerId: ctx.user.id,
          items: { create: itemsCreate(input) },
        },
        select: { id: true },
      });
    }),

  /** Replaces settings and items (templates have no attempts to keep). */
  update: teacherProcedure
    .input(z.object({ id: z.string(), data: templateInput }))
    .mutation(async ({ ctx, input }) => {
      await loadEditable(ctx, input.id);
      await assertExercises(
        ctx,
        input.data.items.map((i) => i.exerciseId),
      );
      await ctx.db.$transaction([
        ctx.db.assignmentTemplateItem.deleteMany({
          where: { templateId: input.id },
        }),
        ctx.db.assignmentTemplate.update({
          where: { id: input.id },
          data: {
            ...baseData(input.data),
            items: { create: itemsCreate(input.data) },
          },
        }),
      ]);
      return { id: input.id };
    }),

  delete: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadEditable(ctx, input.id);
      await ctx.db.assignmentTemplate.delete({ where: { id: input.id } });
    }),

  /** Private copy (also for shared templates of other teachers). */
  duplicate: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const src = await ctx.db.assignmentTemplate.findFirst({
        where: { AND: [{ id: input.id }, templateReadableWhere(ctx.user)] },
        include: { items: { orderBy: { order: "asc" } } },
      });
      if (!src) throw new TRPCError({ code: "NOT_FOUND" });
      await assertExercises(
        ctx,
        src.items.map((i) => i.exerciseId),
      );
      return ctx.db.assignmentTemplate.create({
        data: {
          title: `${src.title} (copy)`,
          description: src.description,
          mode: src.mode,
          maxChecks: src.maxChecks,
          allowHints: src.allowHints,
          hintPenalty: src.hintPenalty,
          allowCheatSheet: src.allowCheatSheet,
          allowPaste: src.allowPaste,
          durationMinutes: src.durationMinutes,
          visibility: "PRIVATE",
          ownerId: ctx.user.id,
          items: {
            create: src.items.map((i) => ({
              exerciseId: i.exerciseId,
              order: i.order,
              points: i.points,
              gate: i.gate,
            })),
          },
        },
        select: { id: true },
      });
    }),

  /** Saves an existing assignment's exercises and settings as a template. */
  fromAssignment: teacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        include: { items: { orderBy: { order: "asc" } } },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      await assertExercises(
        ctx,
        a.items.map((i) => i.exerciseId),
      );
      const duration =
        a.opensAt && a.dueAt
          ? Math.round((a.dueAt.getTime() - a.opensAt.getTime()) / 60000)
          : null;
      return ctx.db.assignmentTemplate.create({
        data: {
          title: input.title,
          mode: a.mode,
          maxChecks: a.maxChecks,
          allowHints: a.allowHints,
          hintPenalty: a.hintPenalty,
          allowCheatSheet: a.allowCheatSheet,
          allowPaste: a.allowPaste,
          durationMinutes: duration && duration > 0 ? duration : null,
          ownerId: ctx.user.id,
          items: {
            create: a.items.map((i) => ({
              exerciseId: i.exerciseId,
              order: i.order,
              points: i.points,
              gate: i.gate,
            })),
          },
        },
        select: { id: true },
      });
    }),

  /**
   * Creates an assignment from the template: the template gives exercises
   * and settings, the caller gives title, class/groups and the window.
   */
  use: teacherProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().trim().min(1, "Title is required").max(200),
        classId: z.string().min(1),
        groupIds: z.array(z.string()).max(50).default([]),
        opensAt: z.date().nullable().optional(),
        dueAt: z.date().nullable().optional(),
        published: z.boolean().default(false),
        publishAt: z.date().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.db.assignmentTemplate.findFirst({
        where: { AND: [{ id: input.id }, templateReadableWhere(ctx.user)] },
        include: { items: { orderBy: { order: "asc" } } },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });

      const parsed = assignmentInput.safeParse({
        title: input.title,
        classId: input.classId,
        groupIds: input.groupIds,
        items: t.items.map((i) => ({
          exerciseId: i.exerciseId,
          points: i.points,
          gate: i.gate,
        })),
        opensAt: input.opensAt ?? null,
        dueAt: input.dueAt ?? null,
        maxChecks: t.maxChecks,
        allowHints: t.allowHints,
        hintPenalty: t.hintPenalty,
        allowCheatSheet: t.allowCheatSheet,
        allowPaste: t.allowPaste,
        published: input.published,
        publishAt: input.publishAt ?? null,
        mode: t.mode,
      });
      if (!parsed.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: parsed.error.issues[0]?.message ?? "Invalid input.",
        });
      }
      return createAssignment(ctx, parsed.data);
    }),
});
