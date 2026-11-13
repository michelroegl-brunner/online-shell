"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  CHECK_TYPES,
  MATCH_MODES,
  newCheck,
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
