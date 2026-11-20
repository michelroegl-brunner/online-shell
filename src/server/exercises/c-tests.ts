import "server-only";

import { runInNewContext } from "node:vm";

import { splitArgs, type CTestCase, type StepCheck } from "~/lib/checks";
import { runner, type ShellKind } from "~/server/runner";
import { exerciseDir, type RunResult } from "./run";

/**
 * "C test cases" check: compile the student's C files and run the program
 * on each case.
 *
 * Everything in the box runs AS THE STUDENT (it's their code; root in the
 * box can't drop privileges anyway: no CAP_SETUID). The expected outputs
 * NEVER enter the box: exec scripts are visible to the student's processes
 * (`ps`, /proc/<pid>/cmdline) — and their own program runs during the
 * check — so the box only compiles, runs and returns the raw output, and
 * the comparison happens here. Each case's input does go in: the program
 * gets it anyway.
 *
 * One exec compiles into a fresh temp dir, one exec per case runs the
 * program (so every case gets the full exec output budget), one removes
 * the temp dir.
 */

type CTests = Extract<StepCheck, { type: "c_tests" }>;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** Shell word that decodes a base64 literal (no quoting issues). */
const lit = (s: string) => `"$(printf '%s' '${b64(s)}' | base64 -d)"`;

/** Output bytes kept per case (base64 of it fits the runner's 64 KB cap). */
export const C_OUTPUT_CAP = 40_000;
const ERR_CAP = 2_000;
/**
 * Build dir for the test binary. Not /tmp: Docker mounts tmpfs noexec, so
 * the program couldn't run there. The home volume allows exec (crun runs
 * ./main there too).
 */
const TEMP_BASE = "/home/student/.cache";
const TEMP_RE = /^\/home\/student\/\.cache\/oshell-c-[A-Za-z0-9]{8}$/;

/** Lines of a value shown in the result, indented. */
const SHOW_LINES = 15;

/** What an unusual exit status of the student's program means. */
const CRASH_TEXT: Record<number, string> = {
  137: "took too long (endless loop? waiting for input?)",
  139: "crashed: segmentation fault (bad pointer or array index?)",
  134: "aborted (failed assert, or memory freed twice?)",
  136: "crashed: arithmetic error (division by zero?)",
  135: "crashed: bus error",
  // head stopped reading: more output than C_OUTPUT_CAP.
  141: "printed far too much (endless loop?)",
};

const prelude = (dir: string) => [
  "export HOME=/home/student LC_ALL=C.UTF-8",
  // `dir` comes from a validated slug.
  `cd -- '${dir}' || { echo "✗ The exercise folder is missing."; exit 98; }`,
];

/** Exported for tests. Line 1 of the output: the temp dir. Exit 1 = compile error. */
export function cCompileScript(c: CTests, dir: string) {
  // Files and flags are restricted to plain characters (src/lib/checks.ts).
  const files = c.files
    .split(/\s+/)
    .filter(Boolean)
    .map((f) => `'${f}'`)
    .join(" ");
  const flags = `${c.flags}${c.noWarnings ? " -Werror" : ""}`;
  return [
    ...prelude(dir),
    `mkdir -p ${TEMP_BASE} && T="$(mktemp -d ${TEMP_BASE}/oshell-c-XXXXXXXX)" || exit 98`,
    'echo "$T"',
    `timeout 30 gcc ${flags} -o "$T/prog" ${files} -lm 2>&1 || { rm -rf -- "$T"; exit 1; }`,
  ].join("\n");
}

/**
 * Exported for tests. Runs one case; prints `rc=<n>`, then the stdout and
 * the stderr (capped), each base64 on its own line.
 */
export function cCaseScript(
  t: CTestCase,
  timeout: number,
  dir: string,
  temp: string,
) {
  if (!TEMP_RE.test(temp)) throw new Error(`invalid temp dir: ${temp}`);
  const args = splitArgs(t.args)
    .map((a) => lit(a))
    .join(" ");
  return [
    ...prelude(dir),
    `T='${temp}'`,
    `printf '%s' '${b64(t.stdin)}' | base64 -d > "$T/in"`,
    `a=(${args})`,
    // The exit status comes back through a file because of the pipe.
    `{ timeout -s KILL ${timeout} "$T/prog" "\${a[@]}" < "$T/in" 2>"$T/err"; echo $? > "$T/rc"; } 2>/dev/null | head -c ${C_OUTPUT_CAP + 1} > "$T/out"`,
    'echo "rc=$(cat "$T/rc" 2>/dev/null || echo 0)"',
    'base64 -w0 "$T/out"; echo',
    `head -c ${ERR_CAP} "$T/err" | base64 -w0; echo`,
  ].join("\n");
}

/** Parse a case script's output. null = unexpected output. */
export function parseCaseOutput(stdout: string) {
  const [rcLine, out, err] = stdout.split("\n");
  const m = /^rc=(\d+)$/.exec(rcLine ?? "");
  if (!m) return null;
  const dec = (s: string | undefined) =>
    Buffer.from((s ?? "").trim(), "base64").toString("utf8");
  return { rc: Number(m[1]), out: dec(out), err: dec(err) };
}

// ── comparison (same rules as the bash checks in checks.ts) ──

/** Trailing whitespace per line, CRs and trailing newlines don't matter. */
const normalize = (s: string) =>
  s
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");

const POSIX_CLASSES: Record<string, string> = {
  space: "\\s",
  blank: " \\t",
  digit: "0-9",
  alpha: "A-Za-z",
  alnum: "A-Za-z0-9",
  upper: "A-Z",
  lower: "a-z",
  xdigit: "0-9A-Fa-f",
  punct: "!-\\/:-@\\[-`{-~",
};

/** grep -E style regex → JS: POSIX classes like [[:digit:]] are mapped. */
export function posixRegex(re: string): RegExp | null {
  const js = re.replace(
    /\[:([a-z]+):\]/g,
    (m, name: string) => POSIX_CLASSES[name] ?? m,
  );
  try {
    return new RegExp(js);
  } catch {
    return null;
  }
}

/**
 * The teacher's regex runs in the web process on the student's output, so
 * a pattern with catastrophic backtracking (e.g. `^(a+)+$`) plus crafted
 * output could block the server. It runs in a vm with a time limit (V8
 * interrupts a running regex), on lines cut to MAX_LINE characters.
 */
const REGEX_TIMEOUT_MS = 250;
const MAX_LINE = 2_000;

/** true / false, or "timeout" when the regex took too long. */
export function outputMatches(t: CTestCase, out: string): boolean | "timeout" {
  const got = out.replace(/\n+$/, "");
  switch (t.match) {
    case "exact":
      return normalize(out) === normalize(t.expected);
    case "contains":
      return got.includes(t.expected);
    case "regex": {
      const re = posixRegex(t.expected);
      if (!re) return false;
      const lines = got
        .replace(/\r/g, "")
        .split("\n")
        .map((l) => l.slice(0, MAX_LINE));
      try {
        return runInNewContext(
          "lines.some((l) => re.test(l))",
          { re, lines },
          { timeout: REGEX_TIMEOUT_MS },
        ) as boolean;
      } catch {
        return "timeout";
      }
    }
  }
}

function show(text: string) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const shown = lines.slice(0, SHOW_LINES).map((l) => `      ${l}`);
  if (lines.length > SHOW_LINES) shown.push(`      … (${lines.length} lines)`);
  return shown;
}

// ── run ──

export async function runCTests(
  userId: string,
  ex: { slug: string; shell: ShellKind },
  c: CTests,
): Promise<RunResult> {
  const dir = exerciseDir(ex.slug);
  await runner.ensureBox(userId, ex.shell);

  const comp = await runner.exec(userId, {
    user: "student",
    timeoutMs: 45_000,
    script: cCompileScript(c, dir),
  });
  const [temp = "", ...msgLines] = comp.stdout.split("\n");
  const messages = (msgLines.join("\n") + comp.stderr).trim();
  if (comp.timedOut || comp.exitCode !== 0 || !TEMP_RE.test(temp)) {
    const lines =
      comp.exitCode === 98 || !TEMP_RE.test(temp)
        ? [comp.stdout.trim() || "✗ The program could not be compiled."]
        : ["✗ Compiling failed:", ...show(messages)];
    if (comp.timedOut) lines.push("✗ Compiling took too long.");
    return fail(lines, c, comp.timedOut);
  }

  const lines: string[] = [];
  if (messages) lines.push("⚠ Compiler warnings:", ...show(messages));
  let ok = true;
  let timedOut = false;
  try {
    for (const [i, t] of c.cases.entries()) {
      const name = t.name || `Test ${i + 1}`;
      const res = await runner.exec(userId, {
        user: "student",
        timeoutMs: (c.timeout + 10) * 1000,
        script: cCaseScript(t, c.timeout, dir, temp),
      });
      const r = res.timedOut ? null : parseCaseOutput(res.stdout);
      let why: string | null = null;
      if (!r) {
        timedOut ||= res.timedOut;
        why = "could not be run";
      } else if (CRASH_TEXT[r.rc]) {
        why = CRASH_TEXT[r.rc]!;
      } else if (t.exitCode !== null && r.rc !== t.exitCode) {
        why = `returned ${r.rc} instead of ${t.exitCode}`;
      }
      const matched = !why && r ? outputMatches(t, r.out) : false;
      if (matched === true) {
        lines.push(`✓ ${name}`);
        continue;
      }
      if (matched === "timeout") {
        why = "REGEX_TIMEOUT";
      }
      ok = false;
      lines.push(
        why === "REGEX_TIMEOUT"
          ? `✗ ${name}: can't be checked — the test's regex took too long (tell your teacher)`
          : why
            ? `✗ ${name}: your program ${why}`
            : `✗ ${name}`,
      );
      if (t.hidden) {
        lines.push("      (hidden test: input and output are not shown)");
        continue;
      }
      if (t.args.trim()) lines.push(`    arguments: ${t.args}`);
      if (t.stdin) lines.push("    input:", ...show(t.stdin));
      lines.push(
        `    expected${t.match === "exact" ? "" : ` (${t.match})`}:`,
        ...show(t.expected),
        "    your output:",
        ...(r?.out ? show(r.out) : ["      (nothing)"]),
      );
      if (r?.err.trim()) lines.push("    error output:", ...show(r.err));
    }
  } finally {
    await runner
      .exec(userId, {
        user: "student",
        timeoutMs: 15_000,
        script: `rm -rf -- '${temp}'`,
      })
      .catch(() => undefined);
  }
  if (ok) return { ok, exitCode: 0, output: lines.join("\n"), timedOut };
  return fail(lines, c, timedOut);
}

function fail(lines: string[], c: CTests, timedOut: boolean): RunResult {
  if (c.message) lines.push(c.message);
  return { ok: false, exitCode: 1, output: lines.join("\n"), timedOut };
}
