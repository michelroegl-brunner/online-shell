import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assignmentWhere, isAdmin, type Viewer } from "~/server/access";
import {
  createTRPCRouter,
  protectedProcedure,
  teacherProcedure,
} from "~/server/api/trpc";
import { openExamsFor } from "~/server/assignments/exam";
import { assignmentWhereVisibleTo } from "~/server/assignments/visibility";
import { windowState } from "~/server/assignments/window";
import { loadBuiltinSheets } from "~/server/cheatsheets/builtin";
import { cheatSheetInput } from "~/server/cheatsheets/schema";
import { type db as dbType } from "~/server/db";
import type { Prisma } from "../../../../generated/prisma";

/**
 * Topic cheat sheets. Teachers manage them like exercises (own + SHARED are
 * readable, only the author or an admin edits); students get the sheets
 * matching the exercise they work on (same shell, overlapping tags).
 */

/** Teachers see their own + shared sheets; admins see everything. */
const readableWhere = (u: Viewer): Prisma.CheatSheetWhereInput =>
  isAdmin(u) ? {} : { OR: [{ authorId: u.id }, { visibility: "SHARED" }] };

const canEdit = (u: Viewer, s: { authorId: string }) =>
  isAdmin(u) || s.authorId === u.id;

const isUniqueViolation = (e: unknown) =>
  (e as { code?: string }).code === "P2002";

const slugTaken = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "This slug is already used by another cheat sheet.",
  });

/** Load a sheet the caller may edit, or throw. */
async function loadEditable(db: typeof dbType, user: Viewer, id: string) {
  const sheet = await db.cheatSheet.findUnique({
    where: { id },
    select: { id: true, authorId: true, visibility: true },
  });
  if (!sheet || (sheet.visibility === "PRIVATE" && !canEdit(user, sheet)))
    throw new TRPCError({ code: "NOT_FOUND" });
  if (!canEdit(user, sheet)) throw new TRPCError({ code: "FORBIDDEN" });
  return sheet;
}

/**
 * Assignments the caller may open (same rule as the learn router):
 * students what's visible to them; teachers also their classes' assignments
 * (test run / preview); admins all.
 */
function learnWhere(user: Viewer): Prisma.AssignmentWhereInput {
  if (user.role === "STUDENT") return assignmentWhereVisibleTo(user.id);
  // Don't put assignmentWhere()'s `{}` (admins) into an OR: Prisma drops it.
  if (isAdmin(user)) return {};
  return { OR: [assignmentWhereVisibleTo(user.id), assignmentWhere(user)] };
}

const tagsFilter = z
  .string()
  .trim()
  .toLowerCase()
  .max(40)
  .optional()
  .transform((t) => (t === "" ? undefined : t));

export const cheatsheetRouter = createTRPCRouter({
  list: teacherProcedure
    .input(
      z
        .object({
          q: z.string().trim().max(100).optional(),
          shell: z.enum(["BASH", "PWSH"]).optional(),
          tag: tagsFilter,
          mine: z.boolean().optional(),
          archived: z.boolean().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.cheatSheet.findMany({
        where: {
          AND: [
            readableWhere(ctx.user),
            { archived: input.archived ?? false },
            input.shell ? { shell: input.shell } : {},
            input.tag ? { tags: { has: input.tag } } : {},
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
        orderBy: [{ shell: "asc" }, { order: "asc" }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          slug: true,
          shell: true,
          tags: true,
          order: true,
          visibility: true,
          archived: true,
          updatedAt: true,
          authorId: true,
          author: { select: { name: true } },
        },
      });
      return rows.map((r) => ({ ...r, canEdit: canEdit(ctx.user, r) }));
    }),

  byId: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const sheet = await ctx.db.cheatSheet.findFirst({
        where: { AND: [{ id: input.id }, readableWhere(ctx.user)] },
        include: { author: { select: { name: true } } },
      });
      if (!sheet) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...sheet, canEdit: canEdit(ctx.user, sheet) };
    }),

  create: teacherProcedure
    .input(cheatSheetInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.cheatSheet.create({
          data: { ...input, authorId: ctx.user.id },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw slugTaken();
        throw e;
      }
    }),

  update: teacherProcedure
    .input(z.object({ id: z.string(), data: cheatSheetInput }))
    .mutation(async ({ ctx, input }) => {
      await loadEditable(ctx.db, ctx.user, input.id);
      try {
        return await ctx.db.cheatSheet.update({
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
      await loadEditable(ctx.db, ctx.user, input.id);
      await ctx.db.cheatSheet.update({
        where: { id: input.id },
        data: { archived: input.archived },
      });
    }),

  delete: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadEditable(ctx.db, ctx.user, input.id);
      await ctx.db.cheatSheet.delete({ where: { id: input.id } });
    }),

  /** Built-in sheets (content/cheatsheets) and whether their slug exists. */
  builtins: teacherProcedure.query(async ({ ctx }) => {
    const sheets = await loadBuiltinSheets().catch((e: unknown) => {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Built-in cheat sheets: ${(e as Error).message}`,
      });
    });
    const existing = await ctx.db.cheatSheet.findMany({
      where: { slug: { in: sheets.map((s) => s.slug) } },
      select: { slug: true, authorId: true, updatedAt: true, createdAt: true },
    });
    const bySlug = new Map(existing.map((e) => [e.slug, e]));
    return sheets.map((s) => {
      const e = bySlug.get(s.slug);
      return {
        slug: s.slug,
        title: s.title,
        shell: s.shell,
        tags: s.tags,
        status: !e
          ? ("missing" as const)
          : canEdit(ctx.user, e)
            ? ("exists" as const)
            : ("foreign" as const),
      };
    });
  }),

  /**
   * Import content/cheatsheets. Missing slugs are created (SHARED, by the
   * caller); existing ones are only replaced with `overwrite` and only if
   * the caller may edit them (author or admin). Archived state is kept.
   */
  importBuiltins: teacherProcedure
    .input(z.object({ overwrite: z.boolean().default(false) }).default({}))
    .mutation(async ({ ctx, input }) => {
      let sheets;
      try {
        sheets = await loadBuiltinSheets();
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Built-in cheat sheets: ${(e as Error).message}`,
        });
      }
      const existing = await ctx.db.cheatSheet.findMany({
        where: { slug: { in: sheets.map((s) => s.slug) } },
        select: { id: true, slug: true, authorId: true },
      });
      const bySlug = new Map(existing.map((e) => [e.slug, e]));
      const created: string[] = [];
      const updated: string[] = [];
      const skipped: { slug: string; reason: string }[] = [];
      for (const s of sheets) {
        const e = bySlug.get(s.slug);
        if (!e) {
          try {
            await ctx.db.cheatSheet.create({
              data: { ...s, visibility: "SHARED", authorId: ctx.user.id },
            });
            created.push(s.slug);
          } catch (err) {
            // Created concurrently by someone else.
            if (!isUniqueViolation(err)) throw err;
            skipped.push({ slug: s.slug, reason: "already exists" });
          }
        } else if (!input.overwrite) {
          skipped.push({ slug: s.slug, reason: "already exists" });
        } else if (!canEdit(ctx.user, e)) {
          skipped.push({ slug: s.slug, reason: "belongs to another teacher" });
        } else {
          await ctx.db.cheatSheet.update({
            where: { id: e.id },
            data: s,
          });
          updated.push(s.slug);
        }
      }
      return { created, updated, skipped };
    }),

  /**
   * Sheets for the exercise of an assignment item (exercise workspace).
   * Students: only if they may open the item, the assignment allows cheat
   * sheets, it isn't locked (upcoming / another exam running). Teachers and
   * admins can call it as a preview. Returns [] when nothing applies.
   */
  forItem: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      const item = await ctx.db.assignmentItem.findFirst({
        where: { id: input.itemId, assignment: learnWhere(user) },
        select: {
          exercise: { select: { shell: true, tags: true } },
          assignment: {
            select: {
              id: true,
              allowCheatSheet: true,
              opensAt: true,
              dueAt: true,
              extensions: {
                where: { userId: user.id },
                select: { extraMinutes: true },
              },
              class: {
                select: { teachers: { select: { userId: true } } },
              },
            },
          },
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const { assignment, exercise } = item;
      if (!assignment.allowCheatSheet || exercise.tags.length === 0) return [];

      if (user.role === "STUDENT") {
        const state = windowState(
          assignment,
          assignment.extensions[0]?.extraMinutes,
        );
        if (state === "upcoming") return [];
        const exams = await openExamsFor(ctx.db, user);
        if (exams.length > 0 && !exams.some((e) => e.id === assignment.id))
          return [];
      }

      // Private sheets of the class's teachers count too (and the caller's
      // own when a teacher previews).
      const owners = new Set(assignment.class.teachers.map((t) => t.userId));
      if (user.role !== "STUDENT") owners.add(user.id);

      return ctx.db.cheatSheet.findMany({
        where: {
          archived: false,
          shell: exercise.shell,
          tags: { hasSome: exercise.tags.map((t) => t.toLowerCase()) },
          OR: [{ visibility: "SHARED" }, { authorId: { in: [...owners] } }],
        },
        orderBy: [{ order: "asc" }, { title: "asc" }],
        select: { id: true, slug: true, title: true, body: true },
      });
    }),
});
