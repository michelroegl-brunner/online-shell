"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Markdown } from "~/components/markdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { EMPTY_STEP, type StepInput } from "~/lib/exercise";
import { cn } from "~/lib/utils";
import { ChecksEditor } from "./checks-editor";
import { Field, Script, ScriptHelp } from "./form-parts";

/** Step as edited in the form: hints as text, plus a stable React key. */
export type StepForm = Omit<StepInput, "hints"> & {
  hints: string;
  /** Client-only key (step id for saved steps). */
  key: string;
  /** Students with progress on this step (saved steps only). */
  attemptCount: number;
};

let keySeq = 0;
const newKey = () => `new-${Date.now()}-${keySeq++}`;

export const toStepForm = (s: StepInput, attemptCount = 0): StepForm => ({
  ...s,
  hints: s.hints.join("\n"),
  key: s.id ?? newKey(),
  attemptCount,
});

export const fromStepForm = ({
  key: _k,
  attemptCount: _a,
  ...s
}: StepForm): StepInput => ({
  ...s,
  hints: s.hints
    .split("\n")
    .map((h) => h.trim())
    .filter(Boolean),
});

export function StepsEditor({
  steps,
  onChange,
  readOnly,
  slug,
}: {
  steps: StepForm[];
  onChange: (steps: StepForm[]) => void;
  readOnly: boolean;
  slug: string;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(steps[0] ? [steps[0].key] : []),
  );
  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const patch = (i: number, p: Partial<StepForm>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  const add = () => {
    const s = toStepForm({ ...EMPTY_STEP, title: `Step ${steps.length + 1}` });
    onChange([...steps, s]);
    setOpen((o) => new Set(o).add(s.key));
  };

  const duplicate = (i: number) => {
    const src = steps[i]!;
    const copy: StepForm = {
      ...src,
      id: undefined,
      key: newKey(),
      attemptCount: 0,
      title: `${src.title} (copy)`,
    };
    const next = [...steps];
    next.splice(i + 1, 0, copy);
    onChange(next);
    setOpen((o) => new Set(o).add(copy.key));
  };

  const remove = (i: number) => {
    const s = steps[i]!;
    if (steps.length === 1) return;
    if (
      s.attemptCount > 0 &&
      !window.confirm(
        `${s.attemptCount} student${s.attemptCount === 1 ? " has" : "s have"} progress on “${s.title}”. Deleting the step deletes that progress when you save. Continue?`,
      )
    ) {
      return;
    }
    onChange(steps.filter((_, j) => j !== i));
  };

  return (
    <div className="flex flex-col gap-3">
      <ScriptHelp>
        All steps share the folder <code>~/exercises/{slug || "<slug>"}</code>:
        the setup runs <b>once</b> for the whole exercise, and later steps see
        the files from earlier steps. Each step has its own check (runs as{" "}
        <b>root</b> in <code>$OSHELL_DIR</code>, <b>exit 0 = step solved</b>,
        its output is shown to the student), points and hints.
      </ScriptHelp>

      {steps.map((s, i) => {
        const isOpen = open.has(s.key);
        const locked = i > 0 && s.requiresPrevious;
        return (
          <div key={s.key} className="rounded-lg border">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(s.key)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="size-4 shrink-0" />
                ) : (
                  <ChevronRight className="size-4 shrink-0" />
                )}
                <span className="text-muted-foreground shrink-0 text-sm">
                  {i + 1}.
                </span>
                <span className="truncate font-medium">
                  {s.title || "Untitled step"}
                </span>
                {locked && (
                  <Lock
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-label="Unlocks after the previous step"
                  />
                )}
                <Badge variant="outline" className="ml-1 shrink-0">
                  {s.points} pts
                </Badge>
                {s.attemptCount > 0 && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {s.attemptCount} with progress
                  </span>
                )}
              </button>
              {!readOnly && (
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move step up"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move step down"
                    title="Move down"
                    disabled={i === steps.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Duplicate step"
                    title="Duplicate"
                    onClick={() => duplicate(i)}
                  >
                    <Copy />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete step"
                    title={
                      steps.length === 1
                        ? "An exercise needs at least one step"
                        : "Delete"
                    }
                    disabled={steps.length === 1}
                    onClick={() => remove(i)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>

            {isOpen && (
              <fieldset
                disabled={readOnly}
                className="flex flex-col gap-4 border-t p-4"
              >
                <div className="grid gap-4 md:grid-cols-6">
                  <Field label="Step title" className="md:col-span-4">
                    <Input
                      value={s.title}
                      onChange={(e) => patch(i, { title: e.target.value })}
                    />
                  </Field>
                  <Field label="Points" className="md:col-span-2">
                    <Input
                      type="number"
                      min={0}
                      value={s.points}
                      onChange={(e) =>
                        patch(i, { points: Number(e.target.value) })
                      }
                    />
                  </Field>
                </div>

                <label
                  className={cn(
                    "flex items-start gap-2 text-sm",
                    i === 0 && "text-muted-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-primary mt-0.5 size-4"
                    checked={i === 0 ? false : s.requiresPrevious}
                    disabled={i === 0}
                    onChange={(e) =>
                      patch(i, { requiresPrevious: e.target.checked })
                    }
                  />
                  <span>
                    Unlocks only after the previous step is solved
                    {i === 0 && (
                      <span className="block text-xs">
                        The first step is always open.
                      </span>
                    )}
                  </span>
                </label>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="Task (Markdown)">
                    <Textarea
                      readOnly={readOnly}
                      className="min-h-40 font-mono text-sm"
                      value={s.description}
                      onChange={(e) =>
                        patch(i, { description: e.target.value })
                      }
                      placeholder="What the student has to do in this step…"
                    />
                  </Field>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-xs tracking-wide uppercase">
                      Preview
                    </span>
                    <div className="rounded-lg border p-3">
                      <Markdown>{s.description || "_Nothing yet._"}</Markdown>
                    </div>
                  </div>
                </div>

                <Field label="Ready-made checks">
                  <ChecksEditor
                    checks={s.checks}
                    readOnly={readOnly}
                    onChange={(checks) => patch(i, { checks })}
                  />
                </Field>

                <Field
                  label={
                    s.checks.length
                      ? "Check script (optional; bash, exit 0 = solved)"
                      : "Check script (bash, exit 0 = solved)"
                  }
                >
                  <Script
                    readOnly={readOnly}
                    className="min-h-56"
                    value={s.checkScript}
                    onChange={(v) => patch(i, { checkScript: v })}
                  />
                </Field>

                <Field label="Hints (one per line, Markdown)">
                  <Textarea
                    readOnly={readOnly}
                    className="min-h-24 text-sm"
                    value={s.hints}
                    onChange={(e) => patch(i, { hints: e.target.value })}
                  />
                </Field>
              </fieldset>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={add}
        >
          <Plus /> Add step
        </Button>
      )}
    </div>
  );
}
