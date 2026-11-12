import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isStaff } from "~/lib/roles";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";
import { devLoginEnabled } from "~/server/auth/config";
import { upsertUser } from "~/server/auth/provision";
import { type db as Db } from "~/server/db";
import {
  getGroup,
  graphEnabled,
  listGroupMembers,
  searchGroups,
} from "~/server/graph";
import type { Prisma } from "../../../../generated/prisma";

type Ctx = { db: typeof Db; user: { id: string; role: string } };

/** Dev classes (no M365 group behind them) when Graph isn't configured. */
const devFallback = () => !graphEnabled && devLoginEnabled;
const DEV_PREFIX = "dev:";

const visibleWhere = (u: Ctx["user"]): Prisma.ClassWhereInput =>
  u.role === "ADMIN" ? {} : { teachers: { some: { userId: u.id } } };

async function loadClass(ctx: Ctx, id: string) {
  const cls = await ctx.db.class.findFirst({
    where: { AND: [{ id }, visibleWhere(ctx.user)] },
  });
  if (!cls) throw new TRPCError({ code: "NOT_FOUND" });
  return cls;
}

async function guardGraph<T>(fn: () => Promise<T>): Promise<T> {
  if (!graphEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Microsoft Graph is not configured (AUTH_MICROSOFT_ENTRA_ID_* variables).",
    });
  }
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    console.error("[class] Graph call failed", e);
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Microsoft Graph request failed. Check that the app has the application permissions Group.Read.All and GroupMember.Read.All with admin consent.",
    });
  }
}

const emptyToNull = (s: string | null | undefined) =>
  s && s.length > 0 ? s : null;

const isUniqueViolation = (e: unknown) =>
  (e as { code?: string }).code === "P2002";

/**
 * Pull the group's members from Graph, upsert them as users and make the
 * class membership match exactly. Teachers/admins are never members.
 */
async function syncFromGraph(
  ctx: Ctx,
  cls: { id: string; entraGroupId: string },
) {
  const members = await guardGraph(() => listGroupMembers(cls.entraGroupId));

  let created = 0;
  let skipped = 0;
  const studentIds: string[] = [];

  for (const m of members) {
    const email = (m.mail ?? m.userPrincipalName)?.toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }
    let user = await ctx.db.user.findUnique({
      where: { entraOid: m.id },
      select: { id: true, role: true },
    });
    if (!user) {
      try {
        user = await ctx.db.user.create({
          data: {
            entraOid: m.id,
            email,
            name: m.displayName ?? email,
            role: "STUDENT",
          },
          select: { id: true, role: true },
        });
        created++;
      } catch (e) {
        // e.g. the email already belongs to another (dev) account
        if (isUniqueViolation(e)) {
          skipped++;
          continue;
        }
        throw e;
      }
    }
    if (user.role === "STUDENT") studentIds.push(user.id);
  }

  await ctx.db.$transaction([
    ctx.db.classMembership.deleteMany({
      where: { classId: cls.id, userId: { notIn: studentIds } },
    }),
    ctx.db.classMembership.createMany({
      data: studentIds.map((userId) => ({ userId, classId: cls.id })),
      skipDuplicates: true,
    }),
  ]);

  return {
    members: members.length,
    students: studentIds.length,
    createdUsers: created,
    skipped,
  };
}

export const classRouter = createTRPCRouter({
  /** Which import path the UI should offer. */
  mode: teacherProcedure.query(() => ({
    graphEnabled,
    devFallback: devFallback(),
  })),

  list: teacherProcedure
    .input(z.object({ archived: z.boolean().optional() }).default({}))
    .query(({ ctx, input }) =>
      ctx.db.class.findMany({
        where: {
          AND: [visibleWhere(ctx.user), { archived: input.archived ?? false }],
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          schoolYear: true,
          archived: true,
          entraGroupId: true,
          _count: { select: { memberships: true } },
          teachers: { select: { user: { select: { name: true } } } },
        },
      }),
    ),

  byId: teacherProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await loadClass(ctx, input.id);
      const cls = await ctx.db.class.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          memberships: {
            orderBy: { user: { name: "asc" } },
            select: {
              syncedAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  lastLoginAt: true,
                },
              },
            },
          },
          teachers: {
            orderBy: { user: { name: "asc" } },
            select: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });
      return { ...cls, isDev: cls.entraGroupId.startsWith(DEV_PREFIX) };
    }),

  /** Search M365 groups; marks the ones already imported. */
  searchGroups: teacherProcedure
    .input(z.object({ q: z.string().trim().max(100) }))
    .query(async ({ ctx, input }) => {
      const groups = await guardGraph(() => searchGroups(input.q));
      const existing = await ctx.db.class.findMany({
        where: { entraGroupId: { in: groups.map((g) => g.id) } },
        select: { id: true, entraGroupId: true },
      });
      const byGroup = new Map(existing.map((c) => [c.entraGroupId, c.id]));
      return groups.map((g) => ({ ...g, classId: byGroup.get(g.id) ?? null }));
    }),

  /**
   * Import a group as a class (caller becomes a teacher of it). If the group
   * was already imported by someone else, the caller is added as co-teacher.
   */
  import: teacherProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        schoolYear: z.string().trim().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.class.findUnique({
        where: { entraGroupId: input.groupId },
      });
      if (existing) {
        await ctx.db.classTeacher.upsert({
          where: {
            classId_userId: { classId: existing.id, userId: ctx.user.id },
          },
          create: { classId: existing.id, userId: ctx.user.id },
          update: {},
        });
        return { id: existing.id, alreadyImported: true, sync: null };
      }

      const group = await guardGraph(() => getGroup(input.groupId));
      const cls = await ctx.db.class.create({
        data: {
          entraGroupId: group.id,
          name: group.displayName,
          schoolYear: emptyToNull(input.schoolYear),
          teachers: { create: { userId: ctx.user.id } },
        },
      });
      const sync = await syncFromGraph(ctx, cls);
      return { id: cls.id, alreadyImported: false, sync };
    }),

  syncMembers: teacherProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const cls = await loadClass(ctx, input.id);
      if (cls.entraGroupId.startsWith(DEV_PREFIX)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Dev classes have no M365 group to sync from.",
        });
      }
      return syncFromGraph(ctx, cls);
    }),

  update: teacherProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(100).optional(),
        schoolYear: z.string().trim().max(20).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadClass(ctx, input.id);
      await ctx.db.class.update({
        where: { id: input.id },
        data: {
          name: input.name,
          schoolYear:
            input.schoolYear === undefined
              ? undefined
              : emptyToNull(input.schoolYear),
        },
      });
    }),

  setArchived: teacherProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await loadClass(ctx, input.id);
      await ctx.db.class.update({
        where: { id: input.id },
        data: { archived: input.archived },
      });
    }),

  addTeacher: teacherProcedure
    .input(z.object({ id: z.string(), email: z.string().trim().email() }))
    .mutation(async ({ ctx, input }) => {
      await loadClass(ctx, input.id);
      const teacher = await ctx.db.user.findUnique({
        where: { email: input.email.toLowerCase() },
        select: { id: true, role: true },
      });
      if (!teacher || !isStaff(teacher.role)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No teacher with this email. They must have signed in once with the Teacher role.",
        });
      }
      await ctx.db.classTeacher.upsert({
        where: { classId_userId: { classId: input.id, userId: teacher.id } },
        create: { classId: input.id, userId: teacher.id },
        update: {},
      });
    }),

  removeTeacher: teacherProcedure
    .input(z.object({ id: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadClass(ctx, input.id);
      const count = await ctx.db.classTeacher.count({
        where: { classId: input.id },
      });
      if (count <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A class needs at least one teacher.",
        });
      }
      await ctx.db.classTeacher.deleteMany({
        where: { classId: input.id, userId: input.userId },
      });
    }),

  // ── dev fallback (no Entra configured, dev login on) ──

  createDev: teacherProcedure
    .input(z.object({ name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (!devFallback()) throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.db.class.create({
        data: {
          name: input.name,
          entraGroupId: `${DEV_PREFIX}${crypto.randomUUID()}`,
          teachers: { create: { userId: ctx.user.id } },
        },
        select: { id: true },
      });
    }),

  addDevStudent: teacherProcedure
    .input(z.object({ id: z.string(), email: z.string().trim().email() }))
    .mutation(async ({ ctx, input }) => {
      if (!devFallback()) throw new TRPCError({ code: "FORBIDDEN" });
      const cls = await loadClass(ctx, input.id);
      if (!cls.entraGroupId.startsWith(DEV_PREFIX)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a dev class.",
        });
      }
      const email = input.email.toLowerCase();
      const existing = await ctx.db.user.findUnique({
        where: { email },
        select: { role: true },
      });
      if (existing && existing.role !== "STUDENT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That account is a teacher/admin, not a student.",
        });
      }
      // Same convention as the dev login (src/server/auth/config.ts).
      const user = await upsertUser({
        entraOid: `dev:${email}`,
        email,
        name: email.split("@")[0] ?? email,
        role: "STUDENT",
      });
      await ctx.db.classMembership.upsert({
        where: { userId_classId: { userId: user.id, classId: cls.id } },
        create: { userId: user.id, classId: cls.id },
        update: {},
      });
    }),

  removeDevStudent: teacherProcedure
    .input(z.object({ id: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const cls = await loadClass(ctx, input.id);
      if (!cls.entraGroupId.startsWith(DEV_PREFIX)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Members of M365 classes are managed in Microsoft 365.",
        });
      }
      await ctx.db.classMembership.deleteMany({
        where: { classId: cls.id, userId: input.userId },
      });
    }),
});
