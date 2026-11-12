import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  assignmentWhere,
  classWhere,
  exerciseReadableWhere,
} from "~/server/access";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";
import { type db as Db } from "~/server/db";

/**
 * Teacher side of assignments (create / edit / publish).
 *
 * Access: a teacher may only touch assignments of classes they teach
 * (ClassTeacher); admins may touch all. Exercises must be readable by the
 * caller (own or SHARED; admins all) — same rule as the exercise router.
 * Only PRACTICE mode for now; exam mode is a later step.
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

async function assertClass(ctx: Ctx, classId: string) {
  const cls = await ctx.db.class.findFirst({
    where: { AND: [{ id: classId }, classWhere(ctx.user)] },
    select: { id: true },
  });
  if (!cls) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
  }
}

const assignmentInput = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    classId: z.string().min(1),
    groupIds: z.array(z.string()).max(50).default([]),
    items: z
      .array(
        z.object({
          exerciseId: z.string().min(1),
          points: z.number().int().min(0).max(1000).nullable().optional(),
        }),
      )
      .max(100),
    opensAt: z.date().nullable().optional(),
    dueAt: z.date().nullable().optional(),
    maxChecks: z.number().int().min(1).max(1000).nullable().optional(),
    allowHints: z.boolean().default(true),
    published: z.boolean().default(false),
    mode: z.literal("PRACTICE").default("PRACTICE"),
  })
  .refine((v) => !v.opensAt || !v.dueAt || v.dueAt > v.opensAt, {
    message: "The due date must be after the opening date.",
    path: ["dueAt"],
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.exerciseId)).size === v.items.length,
    { message: "An exercise can only be added once.", path: ["items"] },
  );

type AssignmentInput = z.infer<typeof assignmentInput>;

/** Validates groups (in class) and exercises (readable). */
async function validateRefs(ctx: Ctx, input: AssignmentInput) {
  await assertClass(ctx, input.classId);

  if (input.groupIds.length) {
    const groups = await ctx.db.classGroup.count({
      where: { id: { in: input.groupIds }, classId: input.classId },
    });
    if (groups !== new Set(input.groupIds).size) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A selected group does not belong to this class.",
      });
    }
  }

  if (input.items.length) {
    const ids = input.items.map((i) => i.exerciseId);
    const found = await ctx.db.exercise.count({
      where: { AND: [{ id: { in: ids } }, exerciseReadableWhere(ctx.user)] },
    });
    if (found !== ids.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "An exercise is missing or not available to you.",
      });
    }
  }
}

const baseData = (input: AssignmentInput) => ({
  title: input.title,
  mode: "PRACTICE" as const,
  opensAt: input.opensAt ?? null,
  dueAt: input.dueAt ?? null,
  maxChecks: input.maxChecks ?? null,
  allowHints: input.allowHints,
  published: input.published,
});

export const assignmentRouter = createTRPCRouter({
  /** Assignments of my classes with targeting + progress counts. */
  list: teacherProcedure
    .input(z.object({ classId: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.assignment.findMany({
        where: {
          AND: [
            assignmentWhere(ctx.user),
            input.classId ? { classId: input.classId } : {},
          ],
        },
        orderBy: [
          { dueAt: { sort: "asc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        select: {
          id: true,
          title: true,
          mode: true,
          opensAt: true,
          dueAt: true,
          published: true,
          updatedAt: true,
          class: {
            select: {
              id: true,
              name: true,
              memberships: { select: { userId: true } },
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
          items: {
            select: {
              _count: { select: { attempts: { where: { status: "PASSED" } } } },
            },
          },
        },
      });

      return rows.map((a) => {
        const classMembers = new Set(a.class.memberships.map((m) => m.userId));
        const targeted = a.groups.length
          ? new Set(
              a.groups.flatMap((g) =>
                g.group.members
                  .map((m) => m.userId)
                  .filter((id) => classMembers.has(id)),
              ),
            ).size
          : classMembers.size;
        const passed = a.items.reduce((s, i) => s + i._count.attempts, 0);
        return {
          id: a.id,
          title: a.title,
          mode: a.mode,
          opensAt: a.opensAt,
          dueAt: a.dueAt,
          published: a.published,
          updatedAt: a.updatedAt,
          class: { id: a.class.id, name: a.class.name },
          groups: a.groups.map((g) => ({ id: g.group.id, name: g.group.name })),
          itemCount: a.items.length,
          students: targeted,
          /** PASSED attempts across all items. */
          passed,
          /** students × items */
          total: targeted * a.items.length,
        };
      });
    }),

  /** Classes the caller may create assignments for (with their groups). */
  classes: teacherProcedure.query(({ ctx }) =>
    ctx.db.class.findMany({
      where: { AND: [classWhere(ctx.user), { archived: false }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        groups: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    }),
  ),

  byId: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await loadAssignment(ctx, input.id);
      const a = await ctx.db.assignment.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          class: {
            select: {
              id: true,
              name: true,
              groups: {
                orderBy: { name: "asc" },
                select: { id: true, name: true },
              },
            },
          },
          groups: { select: { groupId: true } },
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              order: true,
              points: true,
              exercise: {
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  shell: true,
                  points: true,
                  difficulty: true,
                },
              },
              _count: { select: { attempts: true } },
            },
          },
        },
      });
      const attemptCount = a.items.reduce((s, i) => s + i._count.attempts, 0);
      return {
        ...a,
        groupIds: a.groups.map((g) => g.groupId),
        items: a.items.map((i) => ({
          id: i.id,
          order: i.order,
          points: i.points,
          exercise: i.exercise,
          attempts: i._count.attempts,
        })),
        attemptCount,
      };
    }),

  create: teacherProcedure
    .input(assignmentInput)
    .mutation(async ({ ctx, input }) => {
      await validateRefs(ctx, input);
      return ctx.db.assignment.create({
        data: {
          ...baseData(input),
          classId: input.classId,
          groups: { create: input.groupIds.map((groupId) => ({ groupId })) },
          items: {
            create: input.items.map((it, order) => ({
              exerciseId: it.exerciseId,
              order,
              points: it.points ?? null,
            })),
          },
        },
        select: { id: true },
      });
    }),

  /**
   * Update. Items are matched by exercise: kept items (and their attempts!)
   * stay, removed ones are deleted together with their attempts. The UI asks
   * before removing items that already have attempts.
   */
  update: teacherProcedure
    .input(z.object({ id: z.string(), data: assignmentInput }))
    .mutation(async ({ ctx, input }) => {
      const current = await loadAssignment(ctx, input.id);
      const data = input.data;

      if (data.classId !== current.classId) {
        const attempts = await ctx.db.attempt.count({
          where: { assignmentItem: { assignmentId: input.id } },
        });
        if (attempts > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Students already worked on this assignment, so its class can’t change. Duplicate it instead.",
          });
        }
      }
      await validateRefs(ctx, data);

      const existing = await ctx.db.assignmentItem.findMany({
        where: { assignmentId: input.id },
        select: { id: true, exerciseId: true },
      });
      const byExercise = new Map(existing.map((i) => [i.exerciseId, i.id]));
      const keep = new Set(data.items.map((i) => i.exerciseId));
      const removed = existing.filter((i) => !keep.has(i.exerciseId));

      await ctx.db.$transaction([
        ctx.db.assignment.update({
          where: { id: input.id },
          data: { ...baseData(data), classId: data.classId },
        }),
        ctx.db.assignmentGroup.deleteMany({
          where: { assignmentId: input.id },
        }),
        ctx.db.assignmentGroup.createMany({
          data: data.groupIds.map((groupId) => ({
            assignmentId: input.id,
            groupId,
          })),
        }),
        ctx.db.assignmentItem.deleteMany({
          where: { id: { in: removed.map((i) => i.id) } },
        }),
        // Kept items get their new order/points; new exercises are added.
        ...data.items.map((it, order) => {
          const id = byExercise.get(it.exerciseId);
          return id
            ? ctx.db.assignmentItem.update({
                where: { id },
                data: { order, points: it.points ?? null },
              })
            : ctx.db.assignmentItem.create({
                data: {
                  assignmentId: input.id,
                  exerciseId: it.exerciseId,
                  order,
                  points: it.points ?? null,
                },
              });
        }),
      ]);
      return { id: input.id, removedItems: removed.length };
    }),

  setPublished: teacherProcedure
    .input(z.object({ id: z.string(), published: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await loadAssignment(ctx, input.id);
      await ctx.db.assignment.update({
        where: { id: input.id },
        data: { published: input.published },
      });
    }),

  /** Deletes the assignment with all its items and attempts. */
  delete: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadAssignment(ctx, input.id);
      await ctx.db.assignment.delete({ where: { id: input.id } });
    }),

  /**
   * Copy to the same or another class of mine (unpublished). Groups are only
   * copied when staying in the same class.
   */
  duplicate: teacherProcedure
    .input(z.object({ id: z.string(), classId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await loadAssignment(ctx, input.id);
      const src = await ctx.db.assignment.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          groups: { select: { groupId: true } },
          items: { orderBy: { order: "asc" } },
        },
      });
      const classId = input.classId ?? src.classId;
      await assertClass(ctx, classId);
      const sameClass = classId === src.classId;

      // The source may contain exercises the caller can't use (e.g. a
      // co-teacher's private ones): same readability rule as create/update.
      const exerciseIds = [...new Set(src.items.map((i) => i.exerciseId))];
      if (exerciseIds.length) {
        const readable = await ctx.db.exercise.count({
          where: {
            AND: [{ id: { in: exerciseIds } }, exerciseReadableWhere(ctx.user)],
          },
        });
        if (readable !== exerciseIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This assignment uses exercises that aren't available to you, so it can't be duplicated.",
          });
        }
      }

      return ctx.db.assignment.create({
        data: {
          title: `${src.title} (copy)`,
          classId,
          mode: src.mode,
          opensAt: src.opensAt,
          dueAt: src.dueAt,
          maxChecks: src.maxChecks,
          allowHints: src.allowHints,
          allowPaste: src.allowPaste,
          published: false,
          groups: sameClass
            ? { create: src.groups.map((g) => ({ groupId: g.groupId })) }
            : undefined,
          items: {
            create: src.items.map((i) => ({
              exerciseId: i.exerciseId,
              order: i.order,
              points: i.points,
            })),
          },
        },
        select: { id: true },
      });
    }),
});
