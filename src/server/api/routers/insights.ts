import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assignmentWhere, exerciseReadableWhere } from "~/server/access";
import { createTRPCRouter, teacherProcedure } from "~/server/api/trpc";
import { parseVars } from "~/lib/variables";
import { itemMaxPoints } from "~/server/assignments/scoring";
import {
  comparePairs,
  normalize,
  REPORT_THRESHOLD,
  type SimStudent,
  TRIVIAL,
} from "~/server/assignments/similarity";
import { windowState } from "~/server/assignments/window";

/**
 * Teacher insights: the dashboard ("what's happening now"), solutions
 * compared across a class, and per-step exercise analytics.
 */

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// Step analytics thresholds.
const MIN_STARTED = 5;
const LOW_PASS_RATE = 0.4;
const MANY_CHECKS = 4;
const SLOW_FACTOR = 3;

export const insightsRouter = createTRPCRouter({
  /** Start page for teachers. */
  dashboard: teacherProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const recent = new Date(now.getTime() - 30 * 60_000);
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const dayAhead = new Date(now.getTime() + 86_400_000);

    const assignments = await ctx.db.assignment.findMany({
      where: {
        AND: [assignmentWhere(ctx.user), { class: { archived: false } }],
      },
      select: {
        id: true,
        title: true,
        mode: true,
        opensAt: true,
        dueAt: true,
        published: true,
        publishAt: true,
        class: { select: { id: true, name: true } },
        _count: { select: { items: true } },
        items: {
          select: {
            attempts: {
              where: { user: { role: "STUDENT" } },
              select: { userId: true, status: true, updatedAt: true },
            },
          },
        },
      },
    });

    const shaped = assignments.map((a) => {
      const live = a.published || (a.publishAt !== null && a.publishAt <= now);
      const attempts = a.items.flatMap((i) => i.attempts);
      const active = new Set(
        attempts.filter((t) => t.updatedAt >= recent).map((t) => t.userId),
      ).size;
      return {
        id: a.id,
        title: a.title,
        mode: a.mode,
        opensAt: a.opensAt,
        dueAt: a.dueAt,
        publishAt: live ? null : a.publishAt,
        live,
        state: windowState(a, undefined, now),
        className: a.class.name,
        items: a._count.items,
        activeStudents: active,
        started: new Set(attempts.map((t) => t.userId)).size,
        passed: attempts.filter((t) => t.status === "PASSED").length,
      };
    });

    const running = shaped
      .filter(
        (a) =>
          a.live &&
          a.state === "open" &&
          (a.activeStudents > 0 ||
            (a.dueAt !== null && a.dueAt <= dayAhead) ||
            (a.opensAt !== null &&
              now.getTime() - a.opensAt.getTime() < 3 * 3_600_000)),
      )
      .sort((x, y) => y.activeStudents - x.activeStudents);
    const runningIds = new Set(running.map((a) => a.id));
    const upcoming = shaped
      .filter(
        (a) =>
          !runningIds.has(a.id) &&
          ((a.live &&
            a.state !== "closed" &&
            ((a.dueAt !== null && a.dueAt <= weekAhead) ||
              (a.opensAt !== null &&
                a.opensAt > now &&
                a.opensAt <= weekAhead))) ||
            (a.publishAt !== null && a.publishAt <= weekAhead)),
      )
      .map((a) => ({
        ...a,
        // What happens next: publishing, opening or the deadline.
        nextAt:
          a.publishAt ??
          (a.opensAt && a.opensAt > now ? a.opensAt : a.dueAt) ??
          now,
      }))
      .sort((x, y) => x.nextAt.getTime() - y.nextAt.getTime());
    const drafts = shaped.filter((a) => !a.live && !a.publishAt).length;

    // Students who keep failing a step in the last day.
    const stuckRows = await ctx.db.attemptStep.findMany({
      where: {
        status: { not: "PASSED" },
        checks: { gte: 3 },
        updatedAt: { gte: new Date(now.getTime() - 86_400_000) },
        attempt: {
          user: { role: "STUDENT" },
          assignmentItem: { assignment: assignmentWhere(ctx.user) },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        checks: true,
        hintsUsed: true,
        updatedAt: true,
        step: { select: { title: true, order: true } },
        attempt: {
          select: {
            id: true,
            user: { select: { name: true } },
            assignmentItem: {
              select: {
                exercise: { select: { title: true } },
                assignment: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    });
    const stuck = stuckRows.map((r) => ({
      attemptId: r.attempt.id,
      student: r.attempt.user.name,
      exercise: r.attempt.assignmentItem.exercise.title,
      step: r.step.title,
      assignmentId: r.attempt.assignmentItem.assignment.id,
      assignment: r.attempt.assignmentItem.assignment.title,
      checks: r.checks,
      hintsUsed: r.hintsUsed,
      at: r.updatedAt,
    }));

    // Steps that many students fail (exercises I can use).
    const steps = await ctx.db.exerciseStep.findMany({
      where: {
        exercise: {
          AND: [exerciseReadableWhere(ctx.user), { archived: false }],
        },
      },
      select: {
        id: true,
        title: true,
        exercise: { select: { id: true, title: true } },
      },
    });
    const stepIds = steps.map((s) => s.id);
    const studentAttempt = { attempt: { user: { role: "STUDENT" as const } } };
    const [started, passed] = stepIds.length
      ? await Promise.all([
          ctx.db.attemptStep.groupBy({
            by: ["stepId"],
            where: { stepId: { in: stepIds }, ...studentAttempt },
            _count: { _all: true },
          }),
          ctx.db.attemptStep.groupBy({
            by: ["stepId"],
            where: {
              stepId: { in: stepIds },
              status: "PASSED",
              ...studentAttempt,
            },
            _count: { _all: true },
            _avg: { checks: true },
          }),
        ])
      : [[], []];
    const passedBy = new Map(passed.map((p) => [p.stepId, p]));
    const stepById = new Map(steps.map((s) => [s.id, s]));
    const hardSteps = started
      .map((g) => {
        const p = passedBy.get(g.stepId);
        const st = stepById.get(g.stepId)!;
        return {
          exerciseId: st.exercise.id,
          exercise: st.exercise.title,
          step: st.title,
          started: g._count._all,
          passRate: (p?._count._all ?? 0) / g._count._all,
          avgChecks: p?._avg.checks ?? null,
        };
      })
      .filter(
        (s) =>
          s.started >= MIN_STARTED &&
          (s.passRate < LOW_PASS_RATE || (s.avgChecks ?? 0) >= MANY_CHECKS),
      )
      .sort((x, y) => x.passRate - y.passRate)
      .slice(0, 6);

    return {
      running,
      upcoming: upcoming.slice(0, 8),
      drafts,
      stuck,
      hardSteps,
    };
  }),

  /**
   * How students solved each step: the last successful, non-trivial
   * command before the step passed, grouped by identical text. Identical
   * long answers stand out; so do unusual approaches.
   */
  solutions: teacherProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        select: {
          id: true,
          title: true,
          class: { select: { name: true } },
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              exercise: {
                select: {
                  title: true,
                  steps: {
                    orderBy: { order: "asc" },
                    select: { id: true, title: true },
                  },
                },
              },
              attempts: {
                where: { user: { role: "STUDENT" } },
                select: {
                  id: true,
                  startedAt: true,
                  user: { select: { id: true, name: true } },
                  steps: {
                    where: { status: "PASSED", passedAt: { not: null } },
                    select: { stepId: true, passedAt: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });

      const attemptIds = a.items.flatMap((i) => i.attempts.map((t) => t.id));
      const commands = attemptIds.length
        ? await ctx.db.commandLog.findMany({
            where: { attemptId: { in: attemptIds }, exitCode: 0 },
            orderBy: [{ at: "asc" }, { id: "asc" }],
            select: { attemptId: true, at: true, command: true },
            take: 100_000,
          })
        : [];
      const byAttempt = new Map<string, typeof commands>();
      for (const c of commands) {
        const list = byAttempt.get(c.attemptId) ?? [];
        list.push(c);
        byAttempt.set(c.attemptId, list);
      }

      const items = a.items.map((it) => ({
        itemId: it.id,
        title: it.exercise.title,
        steps: it.exercise.steps.map((st) => {
          const groups = new Map<
            string,
            { command: string; students: { name: string; attemptId: string }[] }
          >();
          const unknown: { name: string; attemptId: string }[] = [];
          let solved = 0;
          for (const att of it.attempts) {
            const mine = att.steps.find((x) => x.stepId === st.id);
            if (!mine?.passedAt) continue;
            solved++;
            // Window: since the previous step passed (or the start).
            const before = att.steps
              .map((x) => x.passedAt!)
              .filter((d) => d < mine.passedAt!)
              .sort((x, y) => y.getTime() - x.getTime())[0];
            const from = before ?? att.startedAt;
            const cmds = (byAttempt.get(att.id) ?? []).filter(
              (c) => c.at >= from && c.at <= mine.passedAt!,
            );
            const last = [...cmds]
              .reverse()
              .map((c) => normalize(c.command))
              .find((c) => c && !TRIVIAL.test(c));
            const who = { name: att.user.name, attemptId: att.id };
            if (!last) {
              unknown.push(who);
              continue;
            }
            const g = groups.get(last) ?? { command: last, students: [] };
            g.students.push(who);
            groups.set(last, g);
          }
          const list = [...groups.values()]
            .map((g) => ({
              ...g,
              students: g.students.sort((x, y) =>
                x.name.localeCompare(y.name, "de"),
              ),
              // Same long command typed by several students: worth a look.
              suspicious: g.students.length >= 2 && g.command.length >= 40,
            }))
            .sort((x, y) => y.students.length - x.students.length);
          return {
            stepId: st.id,
            title: st.title,
            solved,
            groups: list,
            unknown,
          };
        }),
      }));

      return {
        assignment: { id: a.id, title: a.title, className: a.class.name },
        items,
      };
    }),

  /**
   * Pairs of students whose work looks copied (see similarity.ts): shared
   * rare commands and mistakes, another student's variable values, steps
   * solved at the same moment. Only pairs above a threshold come back.
   */
  similarity: teacherProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        select: {
          id: true,
          title: true,
          mode: true,
          class: { select: { name: true } },
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              exercise: {
                select: {
                  title: true,
                  steps: {
                    orderBy: { order: "asc" },
                    select: { id: true, title: true },
                  },
                },
              },
              attempts: {
                where: { user: { role: "STUDENT" } },
                select: {
                  id: true,
                  vars: true,
                  user: { select: { id: true, name: true } },
                  steps: {
                    where: { status: "PASSED", passedAt: { not: null } },
                    select: { stepId: true, passedAt: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });

      const attemptIds = a.items.flatMap((i) => i.attempts.map((t) => t.id));
      const commands = attemptIds.length
        ? await ctx.db.commandLog.findMany({
            where: { attemptId: { in: attemptIds } },
            select: { attemptId: true, command: true, exitCode: true },
            take: 200_000,
          })
        : [];
      const byAttempt = new Map<string, typeof commands>();
      for (const c of commands) {
        const list = byAttempt.get(c.attemptId) ?? [];
        list.push(c);
        byAttempt.set(c.attemptId, list);
      }

      // One entry per student across all exercises of the assignment.
      const students = new Map<string, SimStudent>();
      /** userId → itemId → attemptId (links in the UI). */
      const attemptOf: Record<string, Record<string, string>> = {};
      for (const item of a.items) {
        for (const att of item.attempts) {
          const s = students.get(att.user.id) ?? {
            id: att.user.id,
            name: att.user.name,
            commands: [],
            passed: new Map<string, Date>(),
            vars: new Map<string, Record<string, string>>(),
          };
          for (const c of byAttempt.get(att.id) ?? []) {
            s.commands.push({
              itemId: item.id,
              command: c.command,
              exitCode: c.exitCode,
            });
          }
          for (const st of att.steps) s.passed.set(st.stepId, st.passedAt!);
          const vars = parseVars(att.vars);
          if (Object.keys(vars).length) s.vars.set(item.id, vars);
          students.set(att.user.id, s);
          (attemptOf[att.user.id] ??= {})[item.id] = att.id;
        }
      }

      const pairs = comparePairs([...students.values()])
        .filter((p) => p.score >= REPORT_THRESHOLD)
        .slice(0, 60);

      return {
        assignment: {
          id: a.id,
          title: a.title,
          mode: a.mode,
          className: a.class.name,
        },
        students: students.size,
        items: a.items.map((i) => ({ id: i.id, title: i.exercise.title })),
        steps: a.items.flatMap((i) =>
          i.exercise.steps.map((s, idx) => ({
            id: s.id,
            title:
              i.exercise.steps.length > 1
                ? `${i.exercise.title} · ${idx + 1}. ${s.title}`
                : i.exercise.title,
          })),
        ),
        attemptOf,
        pairs,
      };
    }),

  /**
   * Where the class is stuck: per step how many students solved it, are
   * stuck on it (their current step) or haven't got there yet, plus the
   * most common failing check messages and commands on that step.
   */
  heatmap: teacherProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.db.assignment.findFirst({
        where: { AND: [{ id: input.assignmentId }, assignmentWhere(ctx.user)] },
        select: {
          id: true,
          title: true,
          class: {
            select: {
              name: true,
              memberships: {
                where: { user: { role: "STUDENT" } },
                select: { userId: true },
              },
            },
          },
          groups: {
            select: {
              group: { select: { members: { select: { userId: true } } } },
            },
          },
          items: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              exercise: {
                select: {
                  title: true,
                  kind: true,
                  steps: {
                    orderBy: { order: "asc" },
                    select: { id: true, title: true, requiresPrevious: true },
                  },
                },
              },
              attempts: {
                where: { user: { role: "STUDENT" } },
                select: {
                  id: true,
                  startedAt: true,
                  updatedAt: true,
                  user: { select: { id: true, name: true } },
                  steps: {
                    select: {
                      stepId: true,
                      status: true,
                      checks: true,
                      hintsUsed: true,
                      passedAt: true,
                      updatedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });

      // Students the assignment is for (whole class or its groups).
      const targetIds = a.groups.length
        ? new Set(a.groups.flatMap((g) => g.group.members.map((m) => m.userId)))
        : null;
      const target = new Set(
        a.class.memberships
          .map((m) => m.userId)
          .filter((id) => !targetIds || targetIds.has(id)),
      );
      const students = target.size;

      const attemptIds = a.items.flatMap((i) => i.attempts.map((t) => t.id));
      const [failedChecks, failedCmds, lastCmds] = attemptIds.length
        ? await Promise.all([
            ctx.db.attemptEvent.findMany({
              where: {
                attemptId: { in: attemptIds },
                type: "CHECK",
                ok: false,
              },
              select: { stepId: true, detail: true, attemptId: true },
              take: 50_000,
            }),
            ctx.db.commandLog.findMany({
              where: {
                attemptId: { in: attemptIds },
                exitCode: { not: 0 },
                NOT: { exitCode: null },
              },
              select: { attemptId: true, at: true, command: true },
              take: 50_000,
            }),
            ctx.db.commandLog.groupBy({
              by: ["attemptId"],
              where: { attemptId: { in: attemptIds } },
              _max: { at: true },
            }),
          ])
        : [[], [], []];
      const lastCmdAt = new Map(
        lastCmds.map((r) => [r.attemptId, r._max.at ?? null]),
      );
      const failedByAttempt = new Map<string, typeof failedCmds>();
      for (const c of failedCmds) {
        const list = failedByAttempt.get(c.attemptId) ?? [];
        list.push(c);
        failedByAttempt.set(c.attemptId, list);
      }

      const now = Date.now();
      const ACTIVE_MS = 15 * 60_000;
      const top = (m: Map<string, number>, n = 3) =>
        [...m.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, n)
          .map(([text, count]) => ({ text, count }));

      const items = a.items.map((item) => {
        const atts = item.attempts.filter((t) => target.has(t.user.id));
        const stepIds = item.exercise.steps.map((s) => s.id);
        // Per attempt: the step they are on (first one not passed).
        const currentOf = new Map(
          atts.map((t) => {
            const passed = new Set(
              t.steps.filter((s) => s.status === "PASSED").map((s) => s.stepId),
            );
            return [t.id, stepIds.find((id) => !passed.has(id)) ?? null];
          }),
        );
        const steps = item.exercise.steps.map((st, idx) => {
          let passed = 0;
          let failedChecksCount = 0;
          const stuck: {
            name: string;
            attemptId: string;
            checks: number;
            hints: number;
            active: boolean;
            minutes: number;
          }[] = [];
          const cmdCounts = new Map<string, number>();
          for (const t of atts) {
            const row = t.steps.find((s) => s.stepId === st.id);
            if (row?.status === "PASSED") {
              passed++;
              continue;
            }
            if (currentOf.get(t.id) !== st.id) continue;
            // Since when on this step: previous step's pass, or the start.
            const prevId = stepIds[idx - 1];
            const prev = prevId
              ? t.steps.find((s) => s.stepId === prevId)?.passedAt
              : null;
            const since = (prev ?? t.startedAt).getTime();
            const lastAt = Math.max(
              t.updatedAt.getTime(),
              lastCmdAt.get(t.id)?.getTime() ?? 0,
            );
            stuck.push({
              name: t.user.name,
              attemptId: t.id,
              checks: row?.checks ?? 0,
              hints: row?.hintsUsed ?? 0,
              active: now - lastAt < ACTIVE_MS,
              minutes: Math.max(0, Math.round((lastAt - since) / 60_000)),
            });
            for (const c of failedByAttempt.get(t.id) ?? []) {
              if (c.at.getTime() < since) continue;
              const k = normalize(c.command).slice(0, 120);
              if (k && !TRIVIAL.test(k))
                cmdCounts.set(k, (cmdCounts.get(k) ?? 0) + 1);
            }
          }
          const checkCounts = new Map<string, number>();
          for (const e of failedChecks) {
            if (e.stepId !== st.id) continue;
            failedChecksCount++;
            // Group by the first line of what the student was told.
            const first = (e.detail ?? "").split("\n")[0]?.trim() ?? "";
            const k = first === "" ? "(no output)" : first;
            checkCounts.set(k, (checkCounts.get(k) ?? 0) + 1);
          }
          return {
            id: st.id,
            title: st.title,
            passed,
            stuck: stuck.sort(
              (x, y) =>
                Number(y.active) - Number(x.active) || y.minutes - x.minutes,
            ),
            notReached: Math.max(0, students - passed - stuck.length),
            failedChecks: failedChecksCount,
            topCheckMessages: top(checkCounts),
            topFailingCommands: top(cmdCounts),
          };
        });
        return {
          id: item.id,
          title: item.exercise.title,
          kind: item.exercise.kind,
          started: atts.length,
          steps,
        };
      });

      return {
        assignment: { id: a.id, title: a.title, className: a.class.name },
        students,
        items,
      };
    }),

  /** Per-step numbers for one exercise across every assignment that used it. */
  exerciseStats: teacherProcedure
    .input(z.object({ exerciseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const ex = await ctx.db.exercise.findFirst({
        where: {
          AND: [{ id: input.exerciseId }, exerciseReadableWhere(ctx.user)],
        },
        select: {
          id: true,
          points: true,
          kind: true,
          steps: {
            orderBy: { order: "asc" },
            select: { id: true, title: true, points: true, hints: true },
          },
          _count: { select: { assignmentItems: true } },
        },
      });
      if (!ex) throw new TRPCError({ code: "NOT_FOUND" });

      // Only aggregates leave this query (no names), so shared exercises
      // can show numbers from other teachers' classes too.
      const attempts = await ctx.db.attempt.findMany({
        where: {
          assignmentItem: { exerciseId: ex.id },
          user: { role: "STUDENT" },
        },
        select: {
          status: true,
          score: true,
          startedAt: true,
          finishedAt: true,
          resets: true,
          assignmentItem: { select: { points: true } },
          steps: {
            select: {
              stepId: true,
              status: true,
              checks: true,
              hintsUsed: true,
              passedAt: true,
            },
          },
        },
        take: 20_000,
      });

      const steps = ex.steps.map((st) => {
        const rows = attempts.flatMap((att) => {
          const r = att.steps.find((x) => x.stepId === st.id);
          if (!r) return [];
          let minutes: number | null = null;
          if (r.passedAt) {
            const before = att.steps
              .filter((x) => x.passedAt && x.passedAt < r.passedAt!)
              .map((x) => x.passedAt!.getTime());
            const from = before.length
              ? Math.max(...before)
              : att.startedAt.getTime();
            minutes = (r.passedAt.getTime() - from) / 60_000;
          }
          return [{ ...r, minutes }];
        });
        const passed = rows.filter((r) => r.status === "PASSED");
        return {
          id: st.id,
          title: st.title,
          hintCount: st.hints.length,
          started: rows.length,
          passed: passed.length,
          passRate: rows.length ? passed.length / rows.length : null,
          avgChecks: passed.length
            ? passed.reduce((n, r) => n + r.checks, 0) / passed.length
            : null,
          avgHints: rows.length
            ? rows.reduce((n, r) => n + r.hintsUsed, 0) / rows.length
            : null,
          medianMinutes: median(
            passed.map((r) => r.minutes).filter((m): m is number => m !== null),
          ),
        };
      });
      const medians = steps
        .map((s) => s.medianMinutes)
        .filter((m): m is number => m !== null);
      const typical = median(medians);
      const flagged = steps.map((s) => {
        const flags: string[] = [];
        if (s.started >= MIN_STARTED && (s.passRate ?? 1) < LOW_PASS_RATE) {
          flags.push(`only ${Math.round((s.passRate ?? 0) * 100)}% solve it`);
        }
        if ((s.avgChecks ?? 0) >= MANY_CHECKS) {
          flags.push(`${s.avgChecks!.toFixed(1)} checks on average`);
        }
        if (
          typical !== null &&
          steps.length > 1 &&
          s.medianMinutes !== null &&
          s.medianMinutes > 5 &&
          s.medianMinutes > SLOW_FACTOR * typical
        ) {
          flags.push(
            `takes ${Math.round(s.medianMinutes / typical)}× longer than usual`,
          );
        }
        return { ...s, flags };
      });

      const solvedTimes = attempts
        .filter((t) => t.status === "PASSED" && t.finishedAt)
        .map((t) => (t.finishedAt!.getTime() - t.startedAt.getTime()) / 60_000);
      return {
        assignments: ex._count.assignmentItems,
        attempts: attempts.length,
        solved: attempts.filter((t) => t.status === "PASSED").length,
        medianMinutes: median(solvedTimes),
        // Lessons have no points: a score percentage means nothing there.
        avgScorePct:
          attempts.length && ex.kind !== "LESSON"
            ? attempts.reduce(
                (n, t) =>
                  n +
                  (t.score ?? 0) /
                    Math.max(
                      1,
                      itemMaxPoints(t.assignmentItem.points, ex.points),
                    ),
                0,
              ) / attempts.length
            : null,
        avgResets: attempts.length
          ? attempts.reduce((n, t) => n + t.resets, 0) / attempts.length
          : null,
        steps: flagged,
      };
    }),
});
