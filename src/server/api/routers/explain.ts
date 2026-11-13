import { createHash } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { explainSyntaxCheck } from "~/lib/explain/bash-n";
import { explainCommand, functionDefs, type Explanation } from "~/lib/explain";
import { assignmentWhere, isAdmin, type Viewer } from "~/server/access";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ingestCommandLog } from "~/server/assignments/command-log";
import { openExamsFor } from "~/server/assignments/exam";
import { assignmentWhereVisibleTo } from "~/server/assignments/visibility";
import { windowState } from "~/server/assignments/window";
import { exerciseDir } from "~/server/exercises/run";
import { runner } from "~/server/runner";
import type { Prisma } from "../../../../generated/prisma";

/**
 * Explanations for a student's failed commands (from the command log).
 *
 * Rule-based (src/lib/explain): only the command text and exit code are
 * known (stderr is not logged). Off in exams and when the assignment has
 * hints disabled. For bash exercises, *.sh files changed in the last
 * 10 minutes are also syntax-checked with `bash -n` (never executed).
 */

/** Same reach as the learn router: visible to students, teachers test-run. */
function learnWhere(user: Viewer): Prisma.AssignmentWhereInput {
  if (user.role === "STUDENT") return assignmentWhereVisibleTo(user.id);
  if (isAdmin(user)) return {};
  return { OR: [assignmentWhereVisibleTo(user.id), assignmentWhere(user)] };
}

/** Commands to explain (newest), commands to read for context. */
const EXPLAIN_LAST = 15;
const CONTEXT_LAST = 100;
const MAX_ITEMS = 5;

export type ExplainItem = {
  /** CommandLog id (or `bash-n:<file>:<hash>` for a syntax check). */
  id: string;
  at: Date;
  command: string;
  exitCode: number | null;
  explanation: Explanation;
};

export type ExplainRecent =
  { enabled: false } | { enabled: true; items: ExplainItem[] };

/** `bash -n` on recently changed scripts in the exercise folder. */
async function syntaxCheck(
  userId: string,
  slug: string,
): Promise<ExplainItem[]> {
  const script = [
    `cd -- '${exerciseDir(slug)}' 2>/dev/null || exit 0`,
    "find . -maxdepth 2 -type f -name '*.sh' -mmin -10 -size -200k 2>/dev/null | head -n 5 |",
    "while IFS= read -r f; do",
    '  out=$(bash -n -- "$f" 2>&1) && continue',
    '  printf \'%s\\t%s\\t%s\\n\' "$f" "$(stat -c %Y -- "$f")" "$(printf \'%s\' "$out" | head -c 2000 | base64 -w0)"',
    "done",
    "exit 0",
  ].join("\n");
  let stdout: string;
  try {
    const res = await runner.exec(userId, {
      user: "student",
      interpreter: "bash",
      timeoutMs: 5000,
      script,
    });
    if (res.exitCode !== 0 || res.timedOut) return [];
    stdout = res.stdout;
  } catch {
    return []; // no box / runner down
  }
  const items: ExplainItem[] = [];
  for (const line of stdout.split("\n")) {
    const [file, mtime, b64] = line.split("\t");
    if (!file || !b64) continue;
    const output = Buffer.from(b64, "base64").toString("utf8");
    const explanation = explainSyntaxCheck(file, output);
    if (!explanation) continue;
    const hash = createHash("sha1").update(output).digest("hex").slice(0, 12);
    const at = new Date(Number(mtime) * 1000);
    items.push({
      id: `bash-n:${file}:${hash}`,
      at: Number.isNaN(at.getTime()) ? new Date() : at,
      command: `bash -n ${file.replace(/^\.\//, "")}`,
      exitCode: 2,
      explanation,
    });
  }
  return items;
}

export const explainRouter = createTRPCRouter({
  /** Explanations for the caller's latest commands in one exercise. */
  recent: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }): Promise<ExplainRecent> => {
      const user = ctx.user;
      const item = await ctx.db.assignmentItem.findFirst({
        where: { id: input.itemId, assignment: learnWhere(user) },
        select: {
          exercise: { select: { slug: true, shell: true } },
          assignment: {
            select: {
              mode: true,
              allowHints: true,
              opensAt: true,
              dueAt: true,
              extensions: {
                where: { userId: user.id },
                select: { extraMinutes: true },
              },
            },
          },
          attempts: { where: { userId: user.id }, select: { id: true } },
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const off: ExplainRecent = { enabled: false };
      const a = item.assignment;
      if (a.mode === "EXAM" || !a.allowHints) return off;
      const attempt = item.attempts[0];
      if (!attempt) return off;
      if (user.role === "STUDENT") {
        if (windowState(a, a.extensions[0]?.extraMinutes) === "upcoming") {
          return off;
        }
        // No help while any exam is running for the student.
        if ((await openExamsFor(ctx.db, user)).length > 0) return off;
      }

      await ingestCommandLog(user.id);
      const rows = await ctx.db.commandLog.findMany({
        where: { attemptId: attempt.id },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: CONTEXT_LAST,
        select: { id: true, at: true, command: true, exitCode: true },
      });
      const chron = rows.reverse();
      const shell = item.exercise.shell;

      // Functions defined (successfully) before each command.
      const known: string[][] = [];
      const acc = new Set<string>();
      for (const r of chron) {
        known.push([...acc]);
        if (r.exitCode === 0) {
          for (const n of functionDefs(r.command, shell)) acc.add(n);
        }
      }

      const items: ExplainItem[] = [];
      const from = Math.max(0, chron.length - EXPLAIN_LAST);
      for (let i = chron.length - 1; i >= from; i--) {
        const r = chron[i]!;
        const explanation = explainCommand({
          command: r.command,
          exitCode: r.exitCode,
          shell,
          knownFunctions: known[i],
          history: chron.slice(0, i).map((c) => c.command),
        });
        if (!explanation) continue;
        items.push({
          id: r.id.toString(),
          at: r.at,
          command: r.command,
          exitCode: r.exitCode,
          explanation,
        });
      }

      if (shell === "BASH") {
        items.push(...(await syntaxCheck(user.id, item.exercise.slug)));
      }
      items.sort((x, y) => y.at.getTime() - x.at.getTime());
      return { enabled: true, items: items.slice(0, MAX_ITEMS) };
    }),
});
