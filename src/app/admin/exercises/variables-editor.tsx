"use client";

import { Dices, Plus, Trash2 } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import {
  generateVars,
  PREVIEW_SEED,
  VAR_NAME_RE,
  type VariableDef,
  type VariableKind,
} from "~/lib/variables";
import { ScriptHelp } from "./form-parts";

/** Editable shape: choices as text (one per line). */
export type VarForm = {
  name: string;
  kind: VariableKind;
  min: number;
  max: number;
  choices: string;
};

export const toVarForm = (v: VariableDef): VarForm => ({
  name: v.name,
  kind: v.kind,
  min: v.kind === "int" ? v.min : 1,
  max: v.kind === "int" ? v.max : 100,
  choices: v.kind === "choice" ? v.choices.join("\n") : "",
});

export const fromVarForm = (f: VarForm): VariableDef => {
  const name = f.name.trim();
  switch (f.kind) {
    case "int":
      return { kind: "int", name, min: f.min, max: f.max };
    case "choice":
      return {
        kind: "choice",
        name,
        choices: f.choices
          .split("\n")
          .map((c) => c.trim())
          .filter(Boolean),
      };
    case "word":
      return { kind: "word", name };
  }
};

/** Example values for the form (invalid entries are skipped). */
export function exampleVars(vars: VarForm[]) {
  const defs = vars
    .map(fromVarForm)
    .filter(
      (d) =>
        VAR_NAME_RE.test(d.name) &&
        (d.kind !== "choice" || d.choices.length > 0) &&
        (d.kind !== "int" || d.min <= d.max),
    );
  return generateVars(defs, PREVIEW_SEED);
}

export function VariablesEditor({
  vars,
  onChange,
  readOnly,
  unknown,
}: {
  vars: VarForm[];
  onChange: (v: VarForm[]) => void;
  readOnly: boolean;
  /** `{{NAME}}` placeholders used in texts without a variable. */
  unknown: string[];
}) {
  const example = exampleVars(vars);
  const update = (i: number, patch: Partial<VarForm>) =>
    onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  return (
    <div className="flex flex-col gap-3">
      <ScriptHelp>
        Every student gets <b>their own values</b> (picked when they open the
        exercise, the same every time for them), so answers can&apos;t simply be
        copied. Use <code>{"{{NAME}}"}</code> in the intro, step texts, hints
        and ready-made checks, and <code>$NAME</code> (bash) /{" "}
        <code>$env:NAME</code> (pwsh) in the setup and check scripts. Test runs
        use the example values shown here.
      </ScriptHelp>

      {unknown.length > 0 && (
        <p className="text-sm text-amber-400">
          Used in the texts but not defined:{" "}
          {unknown.map((n) => (
            <code key={n} className="mr-1">
              {`{{${n}}}`}
            </code>
          ))}
        </p>
      )}

      {vars.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No variables: everyone gets the same exercise.
        </p>
      )}

      {vars.map((v, i) => {
        const nameOk = VAR_NAME_RE.test(v.name.trim());
        return (
          <div
            key={i}
            className="grid items-start gap-3 rounded-lg border p-3 md:grid-cols-[12rem_10rem_minmax(0,1fr)_auto]"
          >
            <div className="flex flex-col gap-1">
              <Input
                className="font-mono"
                value={v.name}
                readOnly={readOnly}
                placeholder="PORT"
                aria-invalid={!nameOk}
                onChange={(e) =>
                  update(i, {
                    name: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9_]/g, ""),
                  })
                }
              />
              {!nameOk && (
                <span className="text-xs text-red-400">
                  UPPER_CASE, starts with a letter
                </span>
              )}
            </div>
            <Select
              value={v.kind}
              disabled={readOnly}
              onValueChange={(k) => update(i, { kind: k as VariableKind })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="int">Number</SelectItem>
                <SelectItem value="choice">One of a list</SelectItem>
                <SelectItem value="word">Random word</SelectItem>
              </SelectContent>
            </Select>
            <div>
              {v.kind === "int" && (
                <div className="flex items-center gap-2 text-sm">
                  <Input
                    type="number"
                    className="w-28"
                    value={v.min}
                    readOnly={readOnly}
                    onChange={(e) => update(i, { min: Number(e.target.value) })}
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="number"
                    className="w-28"
                    value={v.max}
                    readOnly={readOnly}
                    onChange={(e) => update(i, { max: Number(e.target.value) })}
                  />
                </div>
              )}
              {v.kind === "choice" && (
                <Textarea
                  className="min-h-20 font-mono text-sm"
                  value={v.choices}
                  readOnly={readOnly}
                  placeholder={"One value per line\nalice\nbob"}
                  onChange={(e) => update(i, { choices: e.target.value })}
                />
              )}
              {v.kind === "word" && (
                <p className="text-muted-foreground pt-2 text-sm">
                  A short lowercase word (fruit, tree, animal…).
                </p>
              )}
              {example[v.name.trim()] !== undefined && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Example: <code>{example[v.name.trim()]}</code>
                </p>
              )}
            </div>
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove variable"
                onClick={() => onChange(vars.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={vars.length >= 20}
            onClick={() =>
              onChange([
                ...vars,
                {
                  name: `VAR${vars.length + 1}`,
                  kind: "int",
                  min: 1,
                  max: 100,
                  choices: "",
                },
              ])
            }
          >
            <Plus /> Add variable
          </Button>
        </div>
      )}
    </div>
  );
}

/** Tab label badge: how many variables. */
export function VariablesBadge({ count }: { count: number }) {
  if (count === 0) return <Dices className="ml-1 size-3.5 opacity-60" />;
  return (
    <Badge variant="secondary" className="ml-1">
      {count}
    </Badge>
  );
}
