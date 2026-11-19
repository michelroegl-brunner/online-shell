"use client";

import { EyeOff, Plus, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  CHECK_TYPES,
  MATCH_MODES,
  newCheck,
  newCTestCase,
  type CTestCase,
  type MatchMode,
  type StepCheck,
} from "~/lib/checks";

const MATCH_LABEL: Record<MatchMode, string> = {
  exact: "is exactly",
  contains: "contains",
  regex: "a line matches regex",
};

const selectCls =
  "border-input bg-background h-9 rounded-md border px-2 text-sm disabled:opacity-60";

/** Ready-made checks of one step: a list of small typed forms. */
export function ChecksEditor({
  checks,
  onChange,
  readOnly,
}: {
  checks: StepCheck[];
  onChange: (checks: StepCheck[]) => void;
  readOnly: boolean;
}) {
  const patch = (i: number, c: StepCheck) =>
    onChange(checks.map((x, j) => (j === i ? c : x)));

  return (
    <div className="flex flex-col gap-2">
      {checks.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No ready-made checks. Add some, or write a check script below — or
          both (then everything has to pass).
        </p>
      )}
      {checks.map((c, i) => {
        const meta = CHECK_TYPES.find((t) => t.type === c.type)!;
        return (
          <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{meta.label}</span>
              <span className="text-muted-foreground hidden text-xs md:inline">
                {meta.help}
              </span>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label="Remove check"
                  title="Remove"
                  onClick={() => onChange(checks.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            <CheckFields check={c} onChange={(n) => patch(i, n)} />
            <Input
              placeholder="Message when it fails (optional — a default is shown)"
              value={c.message ?? ""}
              onChange={(e) =>
                patch(i, { ...c, message: e.target.value || undefined })
              }
            />
          </div>
        );
      })}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {CHECK_TYPES.map((t) => (
            <Button
              key={t.type}
              type="button"
              size="sm"
              variant="outline"
              title={t.help}
              onClick={() => onChange([...checks, newCheck(t.type)])}
            >
              <Plus /> {t.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckFields({
  check: c,
  onChange,
}: {
  check: StepCheck;
  onChange: (c: StepCheck) => void;
}) {
  switch (c.type) {
    case "file_exists":
      return (
        <div className="flex flex-wrap gap-2">
          <select
            className={selectCls}
            value={c.kind}
            onChange={(e) =>
              onChange({ ...c, kind: e.target.value as "file" | "dir" })
            }
            aria-label="File or folder"
          >
            <option value="file">File</option>
            <option value="dir">Folder</option>
          </select>
          <Input
            className="min-w-48 flex-1 font-mono"
            placeholder="path/relative/to/exercise-folder"
            value={c.path}
            onChange={(e) => onChange({ ...c, path: e.target.value })}
          />
        </div>
      );
    case "file_content":
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-48 flex-1 font-mono"
              placeholder="result.txt"
              value={c.path}
              onChange={(e) => onChange({ ...c, path: e.target.value })}
            />
            <MatchSelect
              value={c.match}
              onChange={(match) => onChange({ ...c, match })}
            />
          </div>
          <Textarea
            className="min-h-16 font-mono text-sm"
            placeholder={c.match === "regex" ? "^[0-9]+$" : "Expected text"}
            value={c.value}
            onChange={(e) => onChange({ ...c, value: e.target.value })}
          />
        </>
      );
    case "command_output":
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-48 flex-1 font-mono"
              placeholder="ls archive | wc -l"
              value={c.command}
              onChange={(e) => onChange({ ...c, command: e.target.value })}
            />
            <MatchSelect
              value={c.match}
              onChange={(match) => onChange({ ...c, match })}
            />
          </div>
          <Textarea
            className="min-h-16 font-mono text-sm"
            placeholder={c.match === "regex" ? "^[0-9]+$" : "Expected output"}
            value={c.value}
            onChange={(e) => onChange({ ...c, value: e.target.value })}
          />
        </>
      );
    case "c_tests":
      return <CTestsFields check={c} onChange={onChange} />;
    case "command_used":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="min-w-48 flex-1 font-mono"
            placeholder="\bgrep\b.*-r"
            value={c.pattern}
            onChange={(e) => onChange({ ...c, pattern: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={c.successOnly}
              onChange={(e) =>
                onChange({ ...c, successOnly: e.target.checked })
              }
            />
            only if it succeeded (exit 0)
          </label>
        </div>
      );
  }
}

function MatchSelect({
  value,
  onChange,
}: {
  value: MatchMode;
  onChange: (m: MatchMode) => void;
}) {
  return (
    <select
      className={selectCls}
      value={value}
      onChange={(e) => onChange(e.target.value as MatchMode)}
      aria-label="How to compare"
    >
      {MATCH_MODES.map((m) => (
        <option key={m} value={m}>
          {MATCH_LABEL[m]}
        </option>
      ))}
    </select>
  );
}

function CTestsFields({
  check: c,
  onChange,
}: {
  check: Extract<StepCheck, { type: "c_tests" }>;
  onChange: (c: StepCheck) => void;
}) {
  const patchCase = (i: number, t: CTestCase) =>
    onChange({ ...c, cases: c.cases.map((x, j) => (j === i ? t : x)) });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Source files</span>
          <Input
            className="font-mono"
            placeholder="main.c util.c"
            value={c.files}
            onChange={(e) => onChange({ ...c, files: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            gcc flags (-lm is always added)
          </span>
          <Input
            className="font-mono"
            value={c.flags}
            onChange={(e) => onChange({ ...c, flags: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Seconds per test</span>
          <Input
            type="number"
            min={1}
            max={10}
            className="w-24"
            value={c.timeout}
            onChange={(e) =>
              onChange({
                ...c,
                timeout: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
              })
            }
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary size-4"
          checked={c.noWarnings}
          onChange={(e) => onChange({ ...c, noWarnings: e.target.checked })}
        />
        Compiler warnings fail the check (-Werror)
      </label>

      <ol className="flex flex-col gap-2">
        {c.cases.map((t, i) => (
          <li
            key={i}
            className="bg-muted/30 flex flex-col gap-2 rounded-md p-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-14 text-xs">
                Test {i + 1}
              </span>
              <Input
                className="h-8 min-w-32 flex-1"
                placeholder={`Name (default: Test ${i + 1})`}
                value={t.name}
                onChange={(e) => patchCase(i, { ...t, name: e.target.value })}
              />
              <Input
                className="h-8 min-w-32 flex-1 font-mono"
                placeholder="Arguments, e.g. 3 'two words'"
                value={t.args}
                onChange={(e) => patchCase(i, { ...t, args: e.target.value })}
              />
              <Input
                type="number"
                min={0}
                max={255}
                className="h-8 w-28"
                placeholder="exit code"
                title="Expected return value of main (empty = any)"
                value={t.exitCode ?? ""}
                onChange={(e) =>
                  patchCase(i, {
                    ...t,
                    exitCode:
                      e.target.value === ""
                        ? null
                        : Math.min(
                            255,
                            Math.max(0, Math.trunc(Number(e.target.value))),
                          ),
                  })
                }
              />
              <label
                className="flex items-center gap-1.5 text-xs"
                title="The student only sees whether it passed, not the input and expected output."
              >
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={t.hidden}
                  onChange={(e) =>
                    patchCase(i, { ...t, hidden: e.target.checked })
                  }
                />
                <EyeOff className="size-3.5" /> hidden
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Remove test case"
                title="Remove test case"
                disabled={c.cases.length === 1}
                onClick={() =>
                  onChange({ ...c, cases: c.cases.filter((_, j) => j !== i) })
                }
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Textarea
                className="min-h-16 font-mono text-sm"
                placeholder="Input (stdin)"
                value={t.stdin}
                onChange={(e) => patchCase(i, { ...t, stdin: e.target.value })}
              />
              <div className="flex flex-col gap-1">
                <Textarea
                  className="min-h-16 font-mono text-sm"
                  placeholder={
                    t.match === "regex"
                      ? "^Sum: [0-9]+$"
                      : "Expected output (stdout)"
                  }
                  value={t.expected}
                  onChange={(e) =>
                    patchCase(i, { ...t, expected: e.target.value })
                  }
                />
                <MatchSelect
                  value={t.match}
                  onChange={(match) => patchCase(i, { ...t, match })}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
      {c.cases.length < 30 && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() =>
            onChange({ ...c, cases: [...c.cases, newCTestCase()] })
          }
        >
          <Plus /> Test case
        </Button>
      )}
    </div>
  );
}
