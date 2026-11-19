import "server-only";

import {
  describeCheck,
  isBlankScript,
  splitArgs,
  type CTestCase,
  type StepCheck,
} from "~/lib/checks";
import { renderVars, type Vars } from "~/lib/variables";
import { runner, type ShellKind } from "~/server/runner";
import { exerciseDir, runCheck, type RunResult } from "./run";

/**
 * Runs a step's ready-made checks (src/lib/checks.ts) plus its check script.
 *
 * File / output checks become ONE generated bash script that runs like a
 * check script (root, in $OSHELL_DIR, 30 s). Every teacher value is passed
 * base64-encoded, so nothing needs shell quoting. `command_used` is decided
 * here against the attempt's command log (the caller passes the commands;
 * null = no log, e.g. a teacher test run → skipped).
 */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** Shell expression that decodes a base64 literal. */
const lit = (s: string) => `"$(_d '${b64(s)}')"`;

/** bash test for one check; "$p"/"$v"/"$out" are set before it. */
function compare(match: { match: string }, subject: string) {
  switch (match.match) {
    case "exact":
      // Trailing newlines/whitespace and CRs don't matter.
      return `[ "$(printf '%s' ${subject} | tr -d '\\r' | sed -e 's/[[:space:]]*$//')" = "$(printf '%s' "$v" | tr -d '\\r' | sed -e 's/[[:space:]]*$//')" ]`;
    case "contains":
      return `[[ ${subject} == *"$v"* ]]`;
    default:
      return `printf '%s\\n' ${subject} | tr -d '\\r' | grep -qE -- "$v"`;
  }
}

/** Exported for tests. */
export function checksScript(checks: StepCheck[], shell: ShellKind) {
  const lines = [
    "_d() { printf '%s' \"$1\" | base64 -d; }",
    "fail=0",
    'ok() { echo "✓ $1"; }',
    'no() { echo "✗ $1"; fail=1; }',
  ];
  for (const c of checks) {
    if (c.type === "command_used" || c.type === "c_tests") continue;
    const d = describeCheck(c);
    const okMsg = lit(d.ok);
    const failMsg = lit(c.message ?? d.fail);
    switch (c.type) {
      case "file_exists":
        lines.push(
          `p=${lit(c.path)}`,
          `if [ -${c.kind === "dir" ? "d" : "f"} "$p" ]; then ok ${okMsg}; else no ${failMsg}; fi`,
        );
        break;
      case "file_content":
        lines.push(
          `p=${lit(c.path)}; v=${lit(c.value)}`,
          `if [ -f "$p" ] && c="$(cat -- "$p")" && ${compare(c, '"$c"')}; then ok ${okMsg}; else no ${failMsg}; fi`,
        );
        break;
      case "command_output": {
        const run =
          shell === "PWSH"
            ? `timeout 10 pwsh -NoProfile -NonInteractive -Command "$cmd"`
            : `timeout 10 bash -c "$cmd"`;
        lines.push(
          `cmd=${lit(c.command)}; v=${lit(c.value)}`,
          `out="$(cd -- "$OSHELL_DIR" && ${run} </dev/null 2>&1)"`,
          `if ${compare(c, '"$out"')}; then ok ${okMsg}; else no ${failMsg}; fi`,
        );
        break;
      }
    }
  }
  lines.push("exit $fail");
  return lines.join("\n");
}

function commandUsed(
  c: Extract<StepCheck, { type: "command_used" }>,
  commands: { command: string; exitCode: number | null }[],
) {
  let re: RegExp;
  try {
    re = new RegExp(c.pattern);
  } catch {
    return false;
  }
  return commands.some(
    (x) => (!c.successOnly || x.exitCode === 0) && re.test(x.command),
  );
}

/** `{{NAME}}` in a ready-made check's texts → the student's value. */
export function checkWithVars(c: StepCheck, vars: Vars): StepCheck {
  const r = (s: string) => renderVars(s, vars);
  const message = c.message === undefined ? undefined : r(c.message);
  switch (c.type) {
    case "file_exists":
      return { ...c, path: r(c.path), message };
    case "file_content":
      return { ...c, path: r(c.path), value: r(c.value), message };
    case "command_output":
      return { ...c, command: r(c.command), value: r(c.value), message };
    case "c_tests":
      return {
        ...c,
        cases: c.cases.map((t) => ({
          ...t,
          name: r(t.name),
          args: r(t.args),
          stdin: r(t.stdin),
          expected: r(t.expected),
        })),
        message,
      };
    case "command_used":
      // A regex: the value is matched literally.
      return {
        ...c,
        pattern: c.pattern.replace(
          /\{\{\s*([A-Z][A-Z0-9_]{0,30})\s*\}\}/g,
          (m, n: string) =>
            vars[n] === undefined
              ? m
              : vars[n].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        ),
        message,
      };
  }
}

export async function runStepChecks(
  userId: string,
  ex: { slug: string; shell: ShellKind; vars?: Vars },
  step: { checkScript: string; checks: StepCheck[] },
  /** The attempt's commands; null = no command log (test run). */
  commands: { command: string; exitCode: number | null }[] | null,
): Promise<RunResult> {
  const vars = ex.vars ?? {};
  step = { ...step, checks: step.checks.map((c) => checkWithVars(c, vars)) };
  const parts: string[] = [];
  let ok = true;
  let timedOut = false;
  let exitCode = 0;

  const used = step.checks.filter((c) => c.type === "command_used");
  const cTests = step.checks.filter((c) => c.type === "c_tests");
  const inBox = step.checks.filter(
    (c) => c.type !== "command_used" && c.type !== "c_tests",
  );

  for (const c of used) {
    const d = describeCheck(c);
    if (commands === null) {
      parts.push(`– ${d.ok}: skipped in a test run (no command log)`);
      continue;
    }
    if (commandUsed(c, commands)) parts.push(`✓ ${d.ok}`);
    else {
      parts.push(`✗ ${c.message ?? d.fail}`);
      ok = false;
      exitCode ||= 1;
    }
  }

  if (inBox.length) {
    const res = await runCheck(userId, {
      ...ex,
      checkScript: checksScript(inBox, ex.shell),
    });
    if (res.output) parts.push(res.output);
    ok &&= res.ok;
    timedOut ||= res.timedOut;
    if (!res.ok) exitCode ||= res.exitCode;
  }

  for (const c of cTests) {
    const res = await runCTests(userId, ex, c);
    if (res.output) parts.push(res.output);
    ok &&= res.ok;
    timedOut ||= res.timedOut;
    if (!res.ok) exitCode ||= res.exitCode;
  }

  // Without ready-made checks the script always runs (an empty one passes,
  // as before); with them, only if it has real content.
  if (step.checks.length === 0 || !isBlankScript(step.checkScript)) {
    const res = await runCheck(userId, {
      ...ex,
      checkScript: step.checkScript,
    });
    if (res.output) parts.push(res.output);
    ok &&= res.ok;
    timedOut ||= res.timedOut;
    if (!res.ok) exitCode ||= res.exitCode;
  }

  return {
    ok,
    exitCode: ok ? 0 : exitCode || 1,
    output: parts.join("\n"),
    timedOut,
  };
}

// ── C test cases ──────────────────────────────────────────────

/** What an unusual exit status of the student's program means. */
const CRASH_TEXT: [number, string][] = [
  [137, "took too long (endless loop? waiting for input?)"],
  [139, "crashed: segmentation fault (bad pointer or array index?)"],
  [134, "aborted (failed assert, or memory freed twice?)"],
  [136, "crashed: arithmetic error (division by zero?)"],
  [135, "crashed: bus error"],
  // head stopped reading: more than 200 KB of output.
  [141, "printed far too much (endless loop?)"],
];

/** Lines of a value for the result text, shortened. */
const SHOW_LINES = 15;

/**
 * Exported for tests. Compiles the files with gcc and runs every case.
 * Runs as the STUDENT (the student's code must never run as root; root in
 * the box can't drop privileges anyway: no CAP_SETUID). Teacher values are
 * base64-encoded like in checksScript.
 */
export function cTestsScript(
  c: Extract<StepCheck, { type: "c_tests" }>,
  dir: string,
) {
  const files = c.files
    .split(/\s+/)
    .filter(Boolean)
    .map((f) => `'${f}'`)
    .join(" ");
  // flags are restricted to plain characters (src/lib/checks.ts).
  const flags = `${c.flags}${c.noWarnings ? " -Werror" : ""}`;
  const lines = [
    "_d() { printf '%s' \"$1\" | base64 -d; }",
    // Shows at most SHOW_LINES lines, indented.
    `_show() { local n; n="$(printf '%s\\n' "$1" | wc -l)"; printf '%s\\n' "$1" | head -n ${SHOW_LINES} | sed 's/^/      /'; [ "$n" -gt ${SHOW_LINES} ] && echo "      … ($n lines)"; return 0; }`,
    "export HOME=/home/student LC_ALL=C.UTF-8",
    `cd -- '${dir}' || { echo "✗ The exercise folder is missing."; exit 98; }`,
    'T="$(mktemp -d /tmp/oshell-c-XXXXXXXX)" || exit 98',
    "trap 'rm -rf -- \"$T\"' EXIT",
    "fail=0",
    `if ! cout="$(timeout 30 gcc ${flags} -o "$T/prog" ${files} -lm 2>&1)"; then`,
    '  echo "✗ Compiling failed:"',
    '  _show "$cout"',
    "  exit 1",
    "fi",
    'if [ -n "$cout" ]; then echo "⚠ Compiler warnings:"; _show "$cout"; fi',
  ];
  c.cases.forEach((t: CTestCase, i) => {
    const label = t.name || `Test ${i + 1}`;
    const args = splitArgs(t.args)
      .map((a) => lit(a))
      .join(" ");
    lines.push(
      `n=${lit(label)}; v=${lit(t.expected)}; a=(${args})`,
      `_d '${b64(t.stdin)}' > "$T/in"`,
      // Output is capped (an endless printf would fill /tmp); the exit
      // status comes back through a file because of the pipe.
      `{ timeout -s KILL ${c.timeout} "$T/prog" "${"$"}{a[@]}" < "$T/in" 2>"$T/err"; echo $? > "$T/rc"; } 2>/dev/null | head -c 200000 > "$T/out"`,
      'rc="$(cat "$T/rc" 2>/dev/null || echo 0)"; out="$(cat "$T/out")"',
    );
    const crash = CRASH_TEXT.map(
      ([code, text]) => `[ "$rc" = ${code} ] && why=${lit(text)}`,
    ).join("; ");
    // A crash wins; then a wrong exit code; then the output.
    const wrongRc =
      t.exitCode === null
        ? ""
        : `[ -z "$why" ] && [ "$rc" != ${t.exitCode} ] && why="returned $rc instead of ${t.exitCode}"; `;
    lines.push(
      `why=""; ${crash}; ${wrongRc}:`,
      `if [ -z "$why" ] && ${compare(t, '"$out"')}; then ok "$n"; else`,
      '  if [ -n "$why" ]; then no "$n: your program $why"; else no "$n"; fi',
    );
    if (t.hidden) {
      lines.push(
        '  echo "      (hidden test: input and output are not shown)"',
      );
    } else {
      lines.push(
        ...(t.args.trim() ? [`  echo "    arguments: "${lit(t.args)}`] : []),
        ...(t.stdin ? ['  echo "    input:"; _show "$(cat "$T/in")"'] : []),
        `  echo "    expected${t.match === "exact" ? "" : ` (${t.match})`}:"; _show "$v"`,
        '  echo "    your output:"; if [ -n "$out" ]; then _show "$out"; else echo "      (nothing)"; fi',
        '  if [ -s "$T/err" ]; then echo "    error output:"; _show "$(head -c 4000 "$T/err")"; fi',
      );
    }
    lines.push("fi");
  });
  lines.push("exit $fail");
  return [
    'ok() { echo "✓ $1"; }',
    'no() { echo "✗ $1"; fail=1; }',
    ...lines,
  ].join("\n");
}

async function runCTests(
  userId: string,
  ex: { slug: string; shell: ShellKind },
  c: Extract<StepCheck, { type: "c_tests" }>,
): Promise<RunResult> {
  await runner.ensureBox(userId, ex.shell);
  const res = await runner.exec(userId, {
    user: "student",
    timeoutMs: 30_000 + c.cases.length * (c.timeout + 1) * 1000,
    script: cTestsScript(c, exerciseDir(ex.slug)),
  });
  const output = (res.stdout + res.stderr).trimEnd();
  const ok = res.exitCode === 0 && !res.timedOut;
  return {
    ok,
    exitCode: res.exitCode,
    output: res.timedOut
      ? `${output}\n✗ The tests took too long and were stopped.`.trim()
      : !ok && c.message
        ? `${output}\n${c.message}`
        : output,
    timedOut: res.timedOut,
  };
}
