"use client";

import {
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  LayoutTemplate,
  Loader2,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ExerciseSelection } from "./exercise-selection";
import { fromLocalInput, toLocalInput } from "./format";
import { type ShellKind } from "~/lib/shell";

export type EditorItem = {
  exerciseId: string;
  title: string;
  slug: string;
  shell: ShellKind;
  /** Lessons are worth 0 points (no points field). */
  kind: "EXERCISE" | "LESSON";
  defaultPoints: number;
  /** "" = use the exercise's default */
  points: string;
  /** Items after this one stay locked until it is solved. */
  gate: boolean;
  /** Attempts already made on this item (0 for new items). */
  attempts: number;
};

export type EditorInitial = {
  title: string;
  classId: string;
  groupIds: string[];
  items: EditorItem[];
  opensAt: Date | null;
  dueAt: Date | null;
  maxChecks: number | null;
  allowHints: boolean;
  hintPenalty: number;
  allowCheatSheet: boolean;
  allowPaste: boolean;
  published: boolean;
  publishAt: Date | null;
  mode: "PRACTICE" | "EXAM";
};

type Form = Omit<
  EditorInitial,
  "opensAt" | "dueAt" | "maxChecks" | "publishAt"
> & {
  opensAt: string;
  dueAt: string;
  maxChecks: string;
  publishAt: string;
  /** Publish exactly when it opens (publishAt follows opensAt). */
  publishOnOpen: boolean;
};

const toForm = (i: EditorInitial): Form => ({
  ...i,
  opensAt: toLocalInput(i.opensAt),
  dueAt: toLocalInput(i.dueAt),
  maxChecks: i.maxChecks == null ? "" : String(i.maxChecks),
  publishAt: toLocalInput(i.publishAt),
  publishOnOpen:
    !i.published &&
    !!i.publishAt &&
    !!i.opensAt &&
    i.publishAt.getTime() === i.opensAt.getTime(),
});

export function AssignmentEditor({
  id,
  initial,
  attemptCount = 0,
}: {
  /** Undefined = new assignment. */
  id?: string;
  initial: EditorInitial;
  /** Attempts across all items; > 0 locks the class. */
  attemptCount?: number;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [saved, setSaved] = useState<Form>(() => toForm(initial));
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(saved),
    [form, saved],
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const classes = api.assignment.classes.useQuery();
  const cls = classes.data?.find((c) => c.id === form.classId);
  const classLocked = !!id && attemptCount > 0;

  const create = api.assignment.create.useMutation();
  const update = api.assignment.update.useMutation();
  const del = api.assignment.delete.useMutation();
  const duplicate = api.assignment.duplicate.useMutation();
  const setPublished = api.assignment.setPublished.useMutation();
  const toTemplate = api.template.fromAssignment.useMutation();
  const saving = create.isPending || update.isPending;

  function buildInput() {
    const maxChecks = form.maxChecks.trim();
    return {
      title: form.title,
      classId: form.classId,
      groupIds: form.groupIds,
      items: form.items.map((i) => ({
        exerciseId: i.exerciseId,
        // Lessons are always worth 0; don't store a stray override.
        points:
          i.kind === "LESSON" || i.points === "" ? null : Number(i.points),
        gate: i.gate,
      })),
      opensAt: fromLocalInput(form.opensAt),
      dueAt: fromLocalInput(form.dueAt),
      maxChecks: maxChecks === "" ? null : Number(maxChecks),
      allowHints: form.allowHints,
      hintPenalty: form.allowHints ? form.hintPenalty : 0,
      allowCheatSheet: form.allowCheatSheet,
      allowPaste: form.allowPaste,
      published: form.published,
      publishAt: form.published
        ? null
        : fromLocalInput(form.publishOnOpen ? form.opensAt : form.publishAt),
      mode: form.mode,
    };
  }

  async function save() {
    if (!form.title.trim()) return toast.error("Please enter a title.");
    if (!form.classId) return toast.error("Please choose a class.");
    const input = buildInput();
    if (input.opensAt && input.dueAt && input.dueAt <= input.opensAt) {
      return toast.error("The due date must be after the opening date.");
    }
    if (!form.published && form.publishOnOpen && !input.opensAt) {
      return toast.error(
        "Set an opening time, or untick “publish when it opens”.",
      );
    }
    if (input.maxChecks != null && !(input.maxChecks >= 1)) {
      return toast.error("Max checks must be a positive number (or empty).");
    }

    // Removing items that students already worked on deletes their attempts.
    const keep = new Set(form.items.map((i) => i.exerciseId));
    const lost = saved.items.filter(
      (i) => !keep.has(i.exerciseId) && i.attempts > 0,
    );
    if (
      lost.length &&
      !window.confirm(
        `Removing ${lost.map((i) => `"${i.title}"`).join(", ")} deletes ` +
          `${lost.reduce((s, i) => s + i.attempts, 0)} student attempt(s). Continue?`,
      )
    ) {
      return;
    }

    try {
      if (id) {
        await update.mutateAsync({ id, data: input });
        // Removed items are gone; kept items keep their attempt counts.
        const next = { ...form, items: form.items };
        setForm(next);
        setSaved(next);
        await utils.assignment.invalidate();
        toast.success("Saved");
        router.refresh();
      } else {
        const res = await create.mutateAsync(input);
        await utils.assignment.invalidate();
        toast.success("Assignment created");
        router.push(`/admin/assignments/${res.id}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function togglePublished() {
    const next = !form.published;
    // Saved assignment without other edits: publish right away. Otherwise
    // it's part of the form and goes out with the next Save.
    if (id && !dirty) {
      try {
        await setPublished.mutateAsync({ id, published: next });
        const clear = { published: next, publishAt: "", publishOnOpen: false };
        setForm((f) => ({ ...f, ...clear }));
        setSaved((f) => ({ ...f, ...clear }));
        await utils.assignment.invalidate();
        toast.success(
          next ? "Published: students can see it" : "Back to draft",
        );
      } catch (e) {
        toast.error((e as Error).message);
      }
      return;
    }
    set("published", next);
  }

  async function saveAsTemplate() {
    if (!id) return;
    if (dirty) return toast.error("Save your changes first.");
    try {
      const res = await toTemplate.mutateAsync({
        assignmentId: id,
        title: form.title,
      });
      await utils.template.invalidate();
      toast.success("Template created (class and dates aren't part of it)");
      router.push(`/admin/assignments/templates/${res.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove() {
    if (!id) return;
    const msg =
      attemptCount > 0
        ? `Delete this assignment? ${attemptCount} student attempt(s) will be deleted too.`
        : "Delete this assignment?";
    if (!window.confirm(msg)) return;
    try {
      await del.mutateAsync({ id });
      await utils.assignment.invalidate();
      toast.success("Assignment deleted");
      router.push("/admin/assignments");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function copy() {
    if (!id) return;
    try {
      const res = await duplicate.mutateAsync({ id });
      await utils.assignment.invalidate();
      toast.success("Assignment duplicated (unpublished)");
      router.push(`/admin/assignments/${res.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <Link
            href="/admin/assignments"
            className="text-muted-foreground text-sm hover:underline"
          >
            Assignments
          </Link>
          <h1 className="text-2xl font-semibold">
            {id ? form.title || "Untitled" : "New assignment"}
          </h1>
        </div>
        {id && (
          <>
            <Button variant="ghost" asChild>
              <Link
                href={`/learn/a/${id}`}
                title="Go through this assignment like a student (not counted)"
              >
                <FlaskConical /> Test run
              </Link>
            </Button>
            <Button variant="ghost" onClick={() => void copy()}>
              <Copy /> Duplicate
            </Button>
            <Button
              variant="ghost"
              disabled={toTemplate.isPending}
              onClick={() => void saveAsTemplate()}
              title="Reuse these exercises and rules for other classes"
            >
              <LayoutTemplate /> Save as template
            </Button>
            <Button variant="ghost" onClick={() => void remove()}>
              <Trash2 /> Delete
            </Button>
          </>
        )}
        <Button
          variant={form.published ? "secondary" : "outline"}
          disabled={setPublished.isPending}
          onClick={() => void togglePublished()}
          title="Published assignments are visible to students"
        >
          {form.published ? <Eye /> : <EyeOff />}
          {form.published
            ? "Published"
            : form.publishAt || form.publishOnOpen
              ? "Scheduled"
              : "Draft"}
        </Button>
        <Button
          onClick={() => void save()}
          disabled={saving || (!!id && !dirty)}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {id ? (dirty ? "Save" : "Saved") : "Create"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Students see published assignments of their class (or group) once
            they open. Times are local time.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-6">
          <Field label="Title" className="md:col-span-4">
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Week 3: find & grep"
            />
          </Field>
          <Field label="Class" className="md:col-span-2">
            <Select
              value={form.classId}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, classId: v, groupIds: [] }))
              }
              disabled={classLocked}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {classes.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {classLocked && (
              <span className="text-muted-foreground text-xs">
                Locked: students already worked on it.
              </span>
            )}
          </Field>

          <Field label="For" className="md:col-span-6">
            {!cls ? (
              <span className="text-muted-foreground text-sm">
                Choose a class first.
              </span>
            ) : (
              <GroupChips
                groups={cls.groups}
                value={form.groupIds}
                onChange={(groupIds) => set("groupIds", groupIds)}
              />
            )}
          </Field>

          <ModeField value={form.mode} onChange={patch} />

          {!form.published && (
            <Field label="Publish automatically" className="md:col-span-2">
              <Input
                type="datetime-local"
                value={form.publishOnOpen ? form.opensAt : form.publishAt}
                disabled={form.publishOnOpen}
                onChange={(e) => set("publishAt", e.target.value)}
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="accent-primary size-3.5"
                  checked={form.publishOnOpen}
                  onChange={(e) => set("publishOnOpen", e.target.checked)}
                />
                Publish when it opens (students see nothing before)
              </label>
              {!form.publishOnOpen && (
                <span className="text-muted-foreground text-xs">
                  Empty = stays a draft until you publish it.
                </span>
              )}
            </Field>
          )}

          <Field label="Opens" className="md:col-span-2">
            <Input
              type="datetime-local"
              value={form.opensAt}
              onChange={(e) => set("opensAt", e.target.value)}
            />
          </Field>
          <Field label="Due" className="md:col-span-2">
            <Input
              type="datetime-local"
              value={form.dueAt}
              onChange={(e) => set("dueAt", e.target.value)}
            />
          </Field>
          <RuleFields value={form} onChange={patch} />
        </CardContent>
      </Card>

      <ExerciseSelection
        items={form.items}
        onChange={(items) => set("items", items)}
      />
    </div>
  );
}

export type Mode = "PRACTICE" | "EXAM";

/** Rules shared by assignments and templates. */
export type Rules = {
  mode: Mode;
  /** "" = unlimited */
  maxChecks: string;
  allowHints: boolean;
  hintPenalty: number;
  allowCheatSheet: boolean;
  allowPaste: boolean;
};

/** Practice / exam switch (exam also turns hints and pasting off). */
export function ModeField({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (patch: Partial<Rules>) => void;
}) {
  return (
    <Field label="Mode" className="md:col-span-6">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={value === "PRACTICE"}
          onClick={() => onChange({ mode: "PRACTICE" })}
        >
          Practice
        </Chip>
        <Chip
          active={value === "EXAM"}
          onClick={() =>
            onChange({
              mode: "EXAM",
              // Sensible exam defaults; still editable below.
              allowHints: false,
              allowPaste: false,
            })
          }
        >
          Exam
        </Chip>
        <span className="text-muted-foreground text-xs">
          {value === "EXAM"
            ? "Fullscreen, focus loss is logged, check output hidden, playground and other assignments locked while it runs, students hand in at the end."
            : "Students practise at their own pace; check output is shown."}
        </span>
      </div>
    </Field>
  );
}

/** Max checks, hints, hint cost, cheat sheets, pasting (one column each). */
export function RuleFields({
  value,
  onChange,
}: {
  value: Omit<Rules, "mode">;
  onChange: (patch: Partial<Rules>) => void;
}) {
  return (
    <>
      <Field label="Max checks per exercise" className="md:col-span-1">
        <Input
          type="number"
          min={1}
          placeholder="unlimited"
          value={value.maxChecks}
          onChange={(e) => onChange({ maxChecks: e.target.value })}
        />
      </Field>
      <Field label="Hints" className="md:col-span-1">
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={value.allowHints}
            onChange={(e) => onChange({ allowHints: e.target.checked })}
          />
          Allow hints
        </label>
      </Field>
      <Field label="Each hint costs" className="md:col-span-1">
        <div
          className="flex h-9 items-center gap-2 text-sm"
          title="Share of the step's points a student loses for each hint revealed before solving the step. 0 = hints are free."
        >
          <Input
            type="number"
            min={0}
            max={100}
            step={5}
            className="w-20"
            disabled={!value.allowHints}
            value={value.hintPenalty}
            onChange={(e) =>
              onChange({
                hintPenalty: Math.max(
                  0,
                  Math.min(100, Number(e.target.value) || 0),
                ),
              })
            }
          />
          <span className="text-muted-foreground">% of the step</span>
        </div>
      </Field>
      <Field label="Cheat sheets" className="md:col-span-1">
        <label
          className="flex h-9 items-center gap-2 text-sm"
          title="Show topic cheat sheets next to the terminal (matched by the exercise's tags)."
        >
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={value.allowCheatSheet}
            onChange={(e) => onChange({ allowCheatSheet: e.target.checked })}
          />
          Show cheat sheets
        </label>
      </Field>
      <Field label="Terminal" className="md:col-span-1">
        <label
          className="flex h-9 items-center gap-2 text-sm"
          title="Off: students can't paste into their terminals while this assignment is open (also blocked on the server)."
        >
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={value.allowPaste}
            onChange={(e) => onChange({ allowPaste: e.target.checked })}
          />
          Allow pasting
        </label>
      </Field>
    </>
  );
}

/** "Whole class" or a set of groups. */
export function GroupChips({
  groups,
  value,
  onChange,
}: {
  groups: { id: string; name: string }[];
  value: string[];
  onChange: (groupIds: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip active={value.length === 0} onClick={() => onChange([])}>
        Whole class
      </Chip>
      {groups.map((g) => {
        const on = value.includes(g.id);
        return (
          <Chip
            key={g.id}
            active={on}
            onClick={() =>
              onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])
            }
          >
            {g.name}
          </Chip>
        );
      })}
      {groups.length === 0 && (
        <span className="text-muted-foreground text-xs">
          This class has no groups (create them on the class page).
        </span>
      )}
    </div>
  );
}

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
