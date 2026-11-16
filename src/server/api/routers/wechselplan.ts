import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assignmentWhere, classWhere } from "~/server/access";
import {
  type Ctx,
  importGroupAsClass,
  pruneGroupMembers,
} from "~/server/api/routers/class";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";
import {
  fetchTeacherClasses,
  pushGrades,
  teacherRef,
  type WpClass,
  WP_GRADE_FIELDS,
  WechselplanError,
  wechselplanEnabled,
} from "~/server/wechselplan";

/**
 * Wechselplan integration: import the classes a teacher teaches there, mirror
 * their per-weekday groups, and push assignment grades into the Noten grid.
 * Everything acts for the signed-in teacher; Wechselplan decides what they
 * teach. Matching is by Entra ids (see ~/server/wechselplan).
 */

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function requireEnabled() {
  if (!wechselplanEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Wechselplan is not configured (WECHSELPLAN_URL / WECHSELPLAN_API_SECRET).",
    });
  }
}

async function wp<T>(fn: () => Promise<T>): Promise<T> {
  requireEnabled();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WechselplanError) {
      throw new TRPCError({
        code: e.status === 404 ? "NOT_FOUND" : "PRECONDITION_FAILED",
        message:
          e.status === 404 && e.message.includes("Teacher")
            ? "Wechselplan doesn't know you as a teacher (matched by Entra account / e-mail)."
            : e.message,
      });
    }
    throw e;
  }
}

/** The caller's Wechselplan classes. */
async function myWpClasses(ctx: Ctx) {
  const me = await ctx.db.user.findUniqueOrThrow({
    where: { id: ctx.user.id },
    select: { entraOid: true, email: true },
  });
  return wp(() => fetchTeacherClasses(teacherRef(me)));
}

const keyOf = (planClassId: number, weekday: number, groupId: number) =>
  `${planClassId}:${weekday}:${groupId}`;

/**
 * One label per Wechselplan group: "Gruppe 2", with the weekday when the
 * teacher has the class on several days, and the plan's class name when it
 * is a combined class.
 */
function groupLabels(c: WpClass) {
  const multiDay = new Set(c.days.map((d) => d.weekday)).size > 1;
  const labels = new Map<string, string>();
  for (const d of c.days) {
    for (const g of d.groups) {
      let name = `Gruppe ${g.groupId}`;
      if (multiDay) name = `${WEEKDAYS[d.weekday] ?? d.weekday} ${name}`;
      if (d.planClassName && d.planClassName !== c.name) {
        name = `${name} (${d.planClassName})`;
      }
      labels.set(keyOf(d.planClassId, d.weekday, g.groupId), name.slice(0, 50));
    }
  }
  return labels;
}

/** Wechselplan student → our user id (class members only). */
async function studentMatcher(ctx: Ctx, classId: string) {
  const members = await ctx.db.classMembership.findMany({
    where: { classId },
    select: { user: { select: { id: true, entraOid: true, email: true } } },
  });
  const byOid = new Map(members.map((m) => [m.user.entraOid, m.user.id]));
  const byEmail = new Map(
    members.map((m) => [m.user.email.toLowerCase(), m.user.id]),
  );
  const match = (s: { oid: string | null; email: string | null }) =>
    (s.oid ? byOid.get(s.oid) : undefined) ??
    (s.email ? byEmail.get(s.email.toLowerCase()) : undefined) ??
    null;
  return { members, match };
}

/**
 * Make the class's Wechselplan groups match Wechselplan: create/rename them,
 * set their members, and remove ones that no longer exist there (unless an
 * assignment targets them). Groups made by hand are left alone.
 */
async function syncGroups(ctx: Ctx, classId: string, c: WpClass) {
  const labels = groupLabels(c);
  const { match } = await studentMatcher(ctx, classId);
  const existing = await ctx.db.classGroup.findMany({
    where: { classId },
    select: {
      id: true,
      name: true,
      wechselplanKey: true,
      _count: { select: { assignments: true } },
    },
  });

  let created = 0;
  let updated = 0;
  const matched = new Set<string>();
  const unmatched = new Set<string>();

  for (const d of c.days) {
    for (const g of d.groups) {
      const key = keyOf(d.planClassId, d.weekday, g.groupId);
      let name = labels.get(key)!;
      const userIds: string[] = [];
      for (const s of g.students) {
        const id = match(s);
        if (id) {
          userIds.push(id);
          matched.add(id);
        } else {
          unmatched.add(s.oid ?? s.email ?? "");
        }
      }

      let group =
        existing.find((x) => x.wechselplanKey === key) ??
        // Adopt a hand-made group of the same name.
        existing.find((x) => x.wechselplanKey === null && x.name === name);
      const taken = existing.find((x) => x.name === name && x.id !== group?.id);
      if (taken) name = `${name} [${key}]`.slice(0, 50);

      if (group) {
        if (group.name !== name || group.wechselplanKey !== key) {
          await ctx.db.classGroup.update({
            where: { id: group.id },
            data: { name, wechselplanKey: key },
          });
          group.name = name;
          group.wechselplanKey = key;
        }
        updated++;
      } else {
        const row = await ctx.db.classGroup.create({
          data: { classId, name, wechselplanKey: key },
          select: { id: true },
        });
        group = {
          id: row.id,
          name,
          wechselplanKey: key,
          _count: { assignments: 0 },
        };
        existing.push(group);
        created++;
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
    }
  }

  // Wechselplan groups that are gone there. Deleting one an assignment
  // targets would widen that assignment to the whole class, so keep those.
  let removed = 0;
  let kept = 0;
  for (const g of existing) {
    if (!g.wechselplanKey || labels.has(g.wechselplanKey)) continue;
    if (g._count.assignments > 0) {
      kept++;
      continue;
    }
    await ctx.db.classGroup.delete({ where: { id: g.id } });
    removed++;
  }
  await pruneGroupMembers(ctx.db, classId);

  return {
    groups: labels.size,
    created,
    updated,
    removed,
    /** Gone in Wechselplan but still used by an assignment */
    kept,
    studentsMatched: matched.size,
    /** Wechselplan students who aren't members of the class here */
    studentsMissing: unmatched.size,
  };
}

const findWpClass = (classes: WpClass[], entraGroupId: string) =>
  classes.find((c) => c.externalId === entraGroupId);

export const wechselplanRouter = createTRPCRouter({
  status: teacherProcedure.query(() => ({ enabled: wechselplanEnabled })),

  /** The caller's Wechselplan classes, with the matching class here. */
  classes: teacherProcedure.query(async ({ ctx }) => {
    const res = await myWpClasses(ctx);
    const ids = res.classes.flatMap((c) =>
      c.externalId ? [c.externalId] : [],
    );
    const ours = await ctx.db.class.findMany({
      where: { entraGroupId: { in: ids } },
      select: {
        id: true,
        entraGroupId: true,
        archived: true,
        teachers: { where: { userId: ctx.user.id }, select: { userId: true } },
      },
    });
    const byGroup = new Map(ours.map((c) => [c.entraGroupId, c]));
    return {
      schoolYear: res.schoolYear?.label ?? null,
      classes: res.classes.map((c) => {
        const mine = c.externalId ? byGroup.get(c.externalId) : undefined;
        return {
          externalId: c.externalId,
          name: c.name,
          students: c.students.length,
          weekdays: [...new Set(c.days.map((d) => d.weekday))].map(
            (w) => WEEKDAYS[w] ?? String(w),
          ),
          groups: groupLabels(c).size,
          classId: mine?.id ?? null,
          isTeacher: !!mine && mine.teachers.length > 0,
          archived: mine?.archived ?? false,
        };
      }),
    };
  }),

  /**
   * Import a Wechselplan class (its M365 group) and its groups. Teaching the
   * class in Wechselplan is enough to be added as a teacher of an existing
   * class here.
   */
  importClass: teacherProcedure
    .input(z.object({ externalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const res = await myWpClasses(ctx);
      const c = findWpClass(res.classes, input.externalId);
      if (!c) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't teach this class in Wechselplan.",
        });
      }
      const existing = await ctx.db.class.findUnique({
        where: { entraGroupId: input.externalId },
        select: { id: true },
      });
      let classId: string;
      let sync = null;
      if (existing) {
        await ctx.db.classTeacher.upsert({
          where: {
            classId_userId: { classId: existing.id, userId: ctx.user.id },
          },
          create: { classId: existing.id, userId: ctx.user.id },
          update: {},
        });
        classId = existing.id;
      } else {
        const imported = await importGroupAsClass(
          ctx,
          input.externalId,
          res.schoolYear?.label,
        );
        classId = imported.id;
        sync = imported.sync;
      }
      const groups = await syncGroups(ctx, classId, c);
      return { id: classId, alreadyImported: !!existing, sync, groups };
    }),

  /** Re-pull a class's groups from Wechselplan. */
  pullGroups: teacherProcedure
    .input(z.object({ classId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const cls = await ctx.db.class.findFirst({
        where: { AND: [{ id: input.classId }, classWhere(ctx.user)] },
        select: { id: true, entraGroupId: true },
      });
      if (!cls) throw new TRPCError({ code: "NOT_FOUND" });
      const res = await myWpClasses(ctx);
      const c = findWpClass(res.classes, cls.entraGroupId);
      if (!c) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "This class isn't one you teach in Wechselplan (this school year).",
        });
      }
      return syncGroups(ctx, cls.id, c);
    }),

  /**
   * Where an assignment's grades can go: the caller's weekdays with the class
   * in Wechselplan, each with its groups, their students (our user ids) and
   * the caller's teaching days for that group. A group meets the teacher on
   * its own dates (rotation), so each group gets its own date.
   */
  gradeTargets: teacherProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        select: {
          id: true,
          class: { select: { id: true, entraGroupId: true, name: true } },
          gradePushes: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              createdAt: true,
              field: true,
              sent: true,
              written: true,
              user: { select: { name: true } },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      const res = await myWpClasses(ctx);
      const c = findWpClass(res.classes, a.class.entraGroupId);
      if (!c) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `You don't teach ${a.class.name} in Wechselplan (this school year).`,
        });
      }
      const labels = groupLabels(c);
      const { members, match } = await studentMatcher(ctx, a.class.id);
      const inWp = new Set<string>();
      for (const s of c.students) {
        const id = match(s);
        if (id) inWp.add(id);
      }
      return {
        className: c.name,
        schoolYear: res.schoolYear?.label ?? null,
        days: c.days.map((d) => ({
          weekday: d.weekday,
          label: WEEKDAYS[d.weekday] ?? String(d.weekday),
          planClassName: d.planClassName,
          groups: d.groups.map((g) => ({
            groupId: g.groupId,
            name: labels.get(keyOf(d.planClassId, d.weekday, g.groupId))!,
            userIds: g.students.flatMap((s) => match(s) ?? []),
            teachingDays: g.teachingDays,
          })),
        })),
        /** Class members here that Wechselplan doesn't list */
        notInWechselplan: members
          .map((m) => m.user.id)
          .filter((id) => !inWp.has(id)),
        lastPushes: a.gradePushes,
      };
    }),

  /** Send grades to the Noten grid. Returns one result per entry. */
  pushGrades: teacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        field: z.enum(WP_GRADE_FIELDS),
        overwrite: z.boolean().default(false),
        entries: z
          .array(
            z.object({
              userId: z.string(),
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              period: z.enum(["AM", "PM"]),
              grade: z.number().int().min(1).max(5),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        select: {
          id: true,
          class: { select: { id: true, entraGroupId: true } },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      const me = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { entraOid: true, email: true },
      });

      const members = await ctx.db.classMembership.findMany({
        where: {
          classId: a.class.id,
          userId: { in: input.entries.map((e) => e.userId) },
        },
        select: { user: { select: { id: true, entraOid: true } } },
      });
      const oidOf = new Map(members.map((m) => [m.user.id, m.user.entraOid]));
      const userOf = new Map(members.map((m) => [m.user.entraOid, m.user.id]));
      const entries = input.entries.flatMap((e) => {
        const oid = oidOf.get(e.userId);
        return oid
          ? [
              {
                studentOid: oid,
                date: e.date,
                period: e.period,
                grade: e.grade,
              },
            ]
          : [];
      });
      if (entries.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "None of these students are in the class.",
        });
      }

      const { results } = await wp(() =>
        pushGrades({
          teacher: teacherRef(me),
          classExternalId: a.class.entraGroupId,
          field: input.field,
          overwrite: input.overwrite,
          entries,
        }),
      );
      const written = results.filter((r) => r.status === "written").length;
      await ctx.db.gradePush.create({
        data: {
          assignmentId: a.id,
          userId: ctx.user.id,
          field: input.field,
          sent: entries.length,
          written,
        },
      });
      return {
        written,
        results: results.map((r) => ({
          userId: userOf.get(r.studentOid) ?? null,
          status: r.status,
          existing: r.existing ?? null,
        })),
      };
    }),
});
