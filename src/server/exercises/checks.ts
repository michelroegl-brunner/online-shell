import "server-only";

import { describeCheck, isBlankScript, type StepCheck } from "~/lib/checks";
import { type ShellKind } from "~/server/runner";
import { runCheck, type RunResult } from "./run";

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
function compare(match: StepCheck & { match: string }, subject: string) {
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
    if (c.type === "command_used") continue;
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

export async function runStepChecks(
  userId: string,
  ex: { slug: string; shell: ShellKind },
  step: { checkScript: string; checks: StepCheck[] },
  /** The attempt's commands; null = no command log (test run). */
  commands: { command: string; exitCode: number | null }[] | null,
): Promise<RunResult> {
  const parts: string[] = [];
  let ok = true;
  let timedOut = false;
  let exitCode = 0;

  const used = step.checks.filter((c) => c.type === "command_used");
  const inBox = step.checks.filter((c) => c.type !== "command_used");

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
