"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  Lock,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { LessonBadge } from "~/components/learn/badges";
import { Badge } from "~/components/ui/badge";
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
import { ShellBadge } from "../exercises/exercise-list";
import { fromLocalInput, toLocalInput } from "./format";

export type EditorItem = {
  exerciseId: string;
  title: string;
  slug: string;
  shell: "BASH" | "PWSH";
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

  const classes = api.assignment.classes.useQuery();
  const cls = classes.data?.find((c) => c.id === form.classId);
  const classLocked = !!id && attemptCount > 0;

  const create = api.assignment.create.useMutation();
  const update = api.assignment.update.useMutation();
  const del = api.assignment.delete.useMutation();
  const duplicate = api.assignment.duplicate.useMutation();
  const setPublished = api.assignment.setPublished.useMutation();
  const saving = create.isPending || update.isPending;

  const totalPoints = form.items.reduce(
    (s, i) =>
      i.kind === "LESSON"
        ? s
        : s + (i.points === "" ? i.defaultPoints : Number(i.points) || 0),
    0,
  );
  const lessonCount = form.items.filter((i) => i.kind === "LESSON").length;

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

  function moveItem(idx: number, dir: -1 | 1) {
    const items = [...form.items];
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j]!, items[idx]!];
    set("items", items);
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
              <div className="flex flex-wrap items-center gap-2">
                <Chip
                  active={form.groupIds.length === 0}
                  onClick={() => set("groupIds", [])}
                >
                  Whole class
                </Chip>
                {cls.groups.map((g) => {
                  const on = form.groupIds.includes(g.id);
                  return (
                    <Chip
                      key={g.id}
                      active={on}
                      onClick={() =>
                        set(
                          "groupIds",
                          on
                            ? form.groupIds.filter((x) => x !== g.id)
                            : [...form.groupIds, g.id],
                        )
                      }
                    >
                      {g.name}
                    </Chip>
                  );
                })}
                {cls.groups.length === 0 && (
                  <span className="text-muted-foreground text-xs">
                    This class has no groups (create them on the class page).
                  </span>
                )}
              </div>
            )}
          </Field>

          <Field label="Mode" className="md:col-span-6">
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                active={form.mode === "PRACTICE"}
                onClick={() => set("mode", "PRACTICE")}
              >
                Practice
              </Chip>
              <Chip
                active={form.mode === "EXAM"}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    mode: "EXAM",
                    // Sensible exam defaults; still editable below.
                    allowHints: false,
                    allowPaste: false,
                  }))
                }
              >
                Exam
              </Chip>
              <span className="text-muted-foreground text-xs">
                {form.mode === "EXAM"
                  ? "Fullscreen, focus loss is logged, check output hidden, playground and other assignments locked while it runs, students hand in at the end."
                  : "Students practise at their own pace; check output is shown."}
              </span>
            </div>
          </Field>

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
          <Field label="Max checks per exercise" className="md:col-span-1">
            <Input
              type="number"
              min={1}
              placeholder="unlimited"
              value={form.maxChecks}
              onChange={(e) => set("maxChecks", e.target.value)}
            />
          </Field>
          <Field label="Hints" className="md:col-span-1">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={form.allowHints}
                onChange={(e) => set("allowHints", e.target.checked)}
              />
              Allow hints
            </label>
          </Field>
          <Field label="Cheat sheets" className="md:col-span-1">
            <label
              className="flex h-9 items-center gap-2 text-sm"
              title="Show topic cheat sheets next to the terminal (matched by the exercise's tags)."
            >
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={form.allowCheatSheet}
                onChange={(e) => set("allowCheatSheet", e.target.checked)}
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
                checked={form.allowPaste}
                onChange={(e) => set("allowPaste", e.target.checked)}
              />
              Allow pasting
            </label>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Exercises
            <span className="text-muted-foreground ml-auto text-sm font-normal">
              {form.items.length} exercise{form.items.length === 1 ? "" : "s"},{" "}
              {lessonCount > 0 &&
                `${lessonCount} lesson${lessonCount === 1 ? "" : "s"} (no points), `}
              {totalPoints} points
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {form.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No exercises yet. Add some from the library below.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {form.items.map((it, idx) => (
                <li
                  key={it.exerciseId}
                  className="flex flex-wrap items-center gap-3 rounded-md border p-2"
                >
                  <span className="text-muted-foreground w-6 text-right font-mono text-sm">
                    {idx + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      {it.title}
                      <ShellBadge shell={it.shell} />
                      {it.kind === "LESSON" && <LessonBadge />}
                    </div>
                    <div className="text-muted-foreground font-mono text-xs">
                      {it.slug}
                      {it.attempts > 0 &&
                        ` · ${it.attempts} attempt${it.attempts === 1 ? "" : "s"}`}
                    </div>
                    <label
                      className="mt-1 flex w-fit items-center gap-2 text-xs"
                      title="Students can open the following exercises only after solving this one (e.g. a lesson before its exercises)."
                    >
                      <input
                        type="checkbox"
                        className="accent-primary size-3.5"
                        checked={it.gate}
                        onChange={(e) =>
                          set(
                            "items",
                            form.items.map((x, i) =>
                              i === idx ? { ...x, gate: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      <Lock className="text-muted-foreground size-3" />
                      Must be done before the next ones
                    </label>
                  </div>
                  {it.kind === "LESSON" ? (
                    <span className="text-muted-foreground w-24 text-right text-xs">
                      no points
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        className="w-20"
                        aria-label="Points"
                        placeholder={String(it.defaultPoints)}
                        value={it.points}
                        onChange={(e) =>
                          set(
                            "items",
                            form.items.map((x, i) =>
                              i === idx ? { ...x, points: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <span className="text-muted-foreground text-xs">pts</span>
                    </div>
                  )}
                  <div className="flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move up"
                      disabled={idx === 0}
                      onClick={() => moveItem(idx, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move down"
                      disabled={idx === form.items.length - 1}
                      onClick={() => moveItem(idx, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove"
                      onClick={() =>
                        set(
                          "items",
                          form.items.filter((_, i) => i !== idx),
                        )
                      }
                    >
                      <X />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <ExercisePicker
            added={new Set(form.items.map((i) => i.exerciseId))}
            onAdd={(ex) =>
              set("items", [
                ...form.items,
                {
                  exerciseId: ex.id,
                  title: ex.title,
                  slug: ex.slug,
                  shell: ex.shell,
                  kind: ex.kind,
                  defaultPoints: ex.points,
                  points: "",
                  // A lesson usually comes first and opens the exercises.
                  gate: ex.kind === "LESSON",
                  attempts: 0,
                },
              ])
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ExercisePicker({
  added,
  onAdd,
}: {
  added: Set<string>;
  onAdd: (ex: {
    id: string;
    title: string;
    slug: string;
    shell: "BASH" | "PWSH";
    kind: "EXERCISE" | "LESSON";
    points: number;
  }) => void;
}) {
  const [q, setQ] = useState("");
  const list = api.exercise.list.useQuery({ q: q || undefined });

  return (
    <div className="rounded-md border border-dashed p-3">
      <div className="relative mb-2 w-full sm:w-72">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
        <Input
          placeholder="Search exercise library…"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {list.isLoading && (
          <span className="text-muted-foreground text-sm">Loading…</span>
        )}
        {list.data?.length === 0 && (
          <span className="text-muted-foreground text-sm">
            No exercises found.{" "}
            <Link
              href="/admin/exercises/new"
              className="text-primary underline"
            >
              Create one
            </Link>
            .
          </span>
        )}
        {list.data?.map((ex) => {
          const isAdded = added.has(ex.id);
          return (
            <div
              key={ex.id}
              className="hover:bg-muted/50 flex items-center gap-2 rounded px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  {ex.title}
                  <ShellBadge shell={ex.shell} />
                  {ex.kind === "LESSON" && <LessonBadge />}
                  {ex.tags.slice(0, 3).map((t) => (
                    <Badge key={t} variant="outline" className="text-xs">
                      {t}
                    </Badge>
                  ))}
                </div>
                <div className="text-muted-foreground font-mono text-xs">
                  {ex.slug} ·{" "}
                  {ex.kind === "LESSON" ? "lesson" : `${ex.points} pts`}
                </div>
              </div>
              <Button
                size="sm"
                variant={isAdded ? "ghost" : "secondary"}
                disabled={isAdded}
                onClick={() => onAdd(ex)}
              >
                {isAdded ? (
                  "Added"
                ) : (
                  <>
                    <Plus /> Add
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({
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

function Chip({
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
