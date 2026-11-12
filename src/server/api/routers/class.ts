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

/**
 * Dev classes (no M365 group behind them) are available whenever the dev
 * login is on (never in production), also next to Graph import.
 */
const devFallback = () => devLoginEnabled;
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

/** Drop group memberships of users who are no longer in the class. */
export const pruneGroupMembers = (db: typeof Db, classId: string) =>
  db.classGroupMember.deleteMany({
    where: {
      group: { classId },
      user: { memberships: { none: { classId } } },
    },
  });

/** Group ids of a class, with the class's student ids, for validation. */
async function loadGroup(ctx: Ctx, groupId: string) {
  const group = await ctx.db.classGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new TRPCError({ code: "NOT_FOUND" });
  await loadClass(ctx, group.classId); // access check
  return group;
}

const groupName = z.string().trim().min(1).max(50);

/** "A", "B", …, "Z", "AA", … */
const letter = (i: number): string =>
  i < 26
    ? String.fromCharCode(65 + i)
    : letter(Math.floor(i / 26) - 1) + letter(i % 26);

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
    pruneGroupMembers(ctx.db, cls.id),
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
          groups: {
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              members: { select: { userId: true } },
            },
          },
        },
      });
      return { ...cls, isDev: cls.entraGroupId.startsWith(DEV_PREFIX) };
    }),

  // ── groups (splits of a class) ──

  createGroup: teacherProcedure
    .input(z.object({ classId: z.string(), name: groupName }))
    .mutation(async ({ ctx, input }) => {
      await loadClass(ctx, input.classId);
      try {
        return await ctx.db.classGroup.create({
          data: { classId: input.classId, name: input.name },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A group with this name already exists in this class.",
          });
        }
        throw e;
      }
    }),

  renameGroup: teacherProcedure
    .input(z.object({ groupId: z.string(), name: groupName }))
    .mutation(async ({ ctx, input }) => {
      await loadGroup(ctx, input.groupId);
      try {
        await ctx.db.classGroup.update({
          where: { id: input.groupId },
          data: { name: input.name },
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A group with this name already exists in this class.",
          });
        }
        throw e;
      }
    }),

  deleteGroup: teacherProcedure
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await loadGroup(ctx, input.groupId);
      await ctx.db.classGroup.delete({ where: { id: input.groupId } });
    }),

  /** Replace a group's members. Only students of the class are allowed. */
  setGroupMembers: teacherProcedure
    .input(
      z.object({ groupId: z.string(), userIds: z.array(z.string()).max(500) }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await loadGroup(ctx, input.groupId);
      const userIds = [...new Set(input.userIds)];
      const valid = await ctx.db.classMembership.count({
        where: { classId: group.classId, userId: { in: userIds } },
      });
      if (valid !== userIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only students of this class can be added to its groups.",
        });
      }
      await ctx.db.$transaction([
        ctx.db.classGroupMember.deleteMany({
          where: { groupId: group.id, userId: { notIn: userIds } },
        }),
        ctx.db.classGroupMember.createMany({
          data: userIds.map((userId) => ({ groupId: group.id, userId })),
          skipDuplicates: true,
        }),
      ]);
    }),

  /**
   * Create `count` groups ("Gruppe A", "Gruppe B", … or prefix + letter) and
   * deal the current students into them alphabetically (A gets the first
   * ceil(n/count), …). Existing groups are only deleted with `replace`.
   */
  splitEvenly: teacherProcedure
    .input(
      z.object({
        classId: z.string(),
        count: z.number().int().min(2).max(26),
        prefix: z.string().trim().max(40).optional(),
        replace: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadClass(ctx, input.classId);
      const existing = await ctx.db.classGroup.count({
        where: { classId: input.classId },
      });
      if (existing > 0 && !input.replace) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This class already has groups. Confirm replacing them to split again.",
        });
      }
      const students = await ctx.db.classMembership.findMany({
        where: { classId: input.classId },
        orderBy: { user: { name: "asc" } },
        select: { userId: true },
      });
      const prefix = input.prefix ? `${input.prefix} ` : "Gruppe ";
      const size = Math.ceil(students.length / input.count);

      await ctx.db.$transaction(async (tx) => {
        if (input.replace) {
          await tx.classGroup.deleteMany({ where: { classId: input.classId } });
        }
        for (let i = 0; i < input.count; i++) {
          const members = students.slice(i * size, (i + 1) * size);
          await tx.classGroup.create({
            data: {
              classId: input.classId,
              name: `${prefix}${letter(i)}`.slice(0, 50),
              members: {
                create: members.map((m) => ({ userId: m.userId })),
              },
            },
          });
        }
      });
      return { groups: input.count, students: students.length };
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
   * Import a group as a class (caller becomes a teacher of it).
   *
   * If the group is already a class, the caller is NOT added: that would let
   * any teacher join any class (and see its students/results) just by
   * importing its group. Existing teachers (and admins) are simply sent to
   * the class; everyone else must be added by a teacher via `addTeacher`.
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
        select: {
          id: true,
          teachers: {
            select: { userId: true, user: { select: { name: true } } },
          },
        },
      });
      if (existing) {
        const isTeacher = existing.teachers.some(
          (t) => t.userId === ctx.user.id,
        );
        if (isTeacher || ctx.user.role === "ADMIN") {
          return { id: existing.id, alreadyImported: true, sync: null };
        }
        const owners = existing.teachers.map((t) => t.user.name).join(", ");
        throw new TRPCError({
          code: "CONFLICT",
          message: `This group is already a class${owners ? ` (teachers: ${owners})` : ""}. Ask one of its teachers to add you.`,
        });
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
      await ctx.db.$transaction([
        ctx.db.classMembership.deleteMany({
          where: { classId: cls.id, userId: input.userId },
        }),
        pruneGroupMembers(ctx.db, cls.id),
      ]);
    }),
});
