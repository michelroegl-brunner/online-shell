import "server-only";

import { randomBytes } from "node:crypto";

import { SLUG_RE } from "~/lib/exercise";
import { runner, type ShellKind } from "~/server/runner";

/**
 * Setup and check execution for an exercise inside a user's box.
 * Shared by the teacher "test run" and (later) student attempts.
 *
 * Teacher scripts are written to a root-only temp file and run from there
 * (not piped via stdin, so `read`/`cat` in a script can't eat the script),
 * then the file is removed, so students never see check logic.
 */

export const HOME = "/home/student";
export const exerciseDir = (slug: string) => `${HOME}/exercises/${slug}`;

export type RunResult = {
  ok: boolean;
  exitCode: number;
  output: string;
  timedOut: boolean;
};

type Ex = { slug: string; shell: ShellKind };

/** Exported for tests only. */
export function wrap(opts: {
  dir: string;
  body: string;
  reset: boolean;
  strict: boolean;
}) {
  const nonce = randomBytes(8).toString("hex");
  const eof = `OSHELL_EOF_${nonce}`;
  const file = `/tmp/oshell-${nonce}.sh`;
  // `dir` comes from a validated slug, so single-quoting is safe.
  return [
    "umask 077",
    `D='${opts.dir}'`,
    opts.reset
      ? 'rm -rf -- "$D" && mkdir -p -- "$D" || exit 98'
      : 'mkdir -p -- "$D" || exit 98',
    'cd -- "$D" || exit 98',
    `export OSHELL_DIR="$D" OSHELL_HOME='${HOME}'`,
    `cat > '${file}' <<'${eof}'`,
    opts.body,
    eof,
    `bash ${opts.strict ? "-e " : ""}'${file}' </dev/null 2>&1`,
    "rc=$?",
    `rm -f -- '${file}'`,
    // Everything in the folder belongs to the student afterwards.
    'chown -R student:student -- "$D"',
    "exit $rc",
  ].join("\n");
}

function assertSlug(slug: string) {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug: ${slug}`);
}

/** Wipe ~/exercises/<slug> and run the setup script in it (as root, set -e). */
export async function runSetup(
  userId: string,
  ex: Ex & { setupScript: string },
): Promise<RunResult> {
  assertSlug(ex.slug);
  await runner.ensureBox(userId, ex.shell);
  const res = await runner.exec(userId, {
    user: "root",
    timeoutMs: 60_000,
    script: wrap({
      dir: exerciseDir(ex.slug),
      body: ex.setupScript,
      reset: true,
      strict: true,
    }),
  });
  return toResult(res);
}

/** Run the check script in ~/exercises/<slug> (as root). Exit 0 = passed. */
export async function runCheck(
  userId: string,
  ex: Ex & { checkScript: string },
): Promise<RunResult> {
  assertSlug(ex.slug);
  await runner.ensureBox(userId, ex.shell);
  const res = await runner.exec(userId, {
    user: "root",
    timeoutMs: 30_000,
    script: wrap({
      dir: exerciseDir(ex.slug),
      body: ex.checkScript,
      reset: false,
      strict: false,
    }),
  });
  return toResult(res);
}

function toResult(res: {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}): RunResult {
  const output = (res.stdout + res.stderr).trimEnd();
  return {
    ok: res.exitCode === 0 && !res.timedOut,
    exitCode: res.exitCode,
    output: res.timedOut ? `${output}\n[timed out]`.trim() : output,
    timedOut: res.timedOut,
  };
}
