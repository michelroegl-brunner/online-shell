"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Lock,
  LockOpen,
  Plus,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { LessonBadge } from "~/components/learn/badges";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { Segmented, ShellBadge } from "../exercises/exercise-list";
import type { EditorItem } from "./assignment-editor";

type LibraryRow = RouterOutputs["exercise"]["list"][number];

/** Tags that only repeat the shell badge; not useful as filters. */
const NOISE_TAGS = new Set(["bash", "pwsh", "powershell"]);

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, undefined, { numeric: true });

function toItem(ex: LibraryRow): EditorItem {
  return {
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
  };
}

export function ExerciseSelection({
  items,
  onChange,
}: {
  items: EditorItem[];
  onChange: (items: EditorItem[]) => void;
}) {
  const totalPoints = items.reduce(
    (s, i) =>
      i.kind === "LESSON"
        ? s
        : s + (i.points === "" ? i.defaultPoints : Number(i.points) || 0),
    0,
  );
  const lessonCount = items.filter((i) => i.kind === "LESSON").length;
  const exerciseCount = items.length - lessonCount;

  const added = useMemo(() => new Set(items.map((i) => i.exerciseId)), [items]);

  function toggle(ex: LibraryRow) {
    onChange(
      added.has(ex.id)
        ? items.filter((i) => i.exerciseId !== ex.id)
        : [...items, toItem(ex)],
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Exercises
          <span className="text-muted-foreground ml-auto text-sm font-normal">
            {exerciseCount} exercise{exerciseCount === 1 ? "" : "s"}
            {lessonCount > 0 &&
              ` · ${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`}
            {" · "}
            <span className="text-foreground font-medium">
              {totalPoints} points
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <SelectedList items={items} onChange={onChange} />
        <Library
          added={added}
          onToggle={toggle}
          onAddMany={(rows) => onChange([...items, ...rows.map(toItem)])}
        />
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- selected */

function SelectedList({
  items,
  onChange,
}: {
  items: EditorItem[];
  onChange: (items: EditorItem[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const patch = (idx: number, p: Partial<EditorItem>) =>
    onChange(items.map((x, i) => (i === idx ? { ...x, ...p } : x)));

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    onChange(next);
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex h-9 items-center justify-between">
        <h3 className="text-sm font-medium">
          In this assignment{" "}
          <span className="text-muted-foreground font-normal">
            ({items.length})
          </span>
        </h3>
        {items.length > 1 && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => {
              if (window.confirm("Remove all exercises from this assignment?"))
                onChange([]);
            }}
          >
            Clear all
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-1 rounded-md border border-dashed p-6 text-center text-sm">
          <span>Nothing selected yet.</span>
          <span className="text-xs">
            Click exercises in the library to add them, then drag to reorder.
          </span>
        </div>
      ) : (
        <ol
          className="flex flex-col"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setOverIdx(null);
          }}
        >
          {items.map((it, idx) => {
            const last = idx === items.length - 1;
            const dropBefore =
              dragIdx !== null && overIdx === idx && dragIdx > idx;
            const dropAfter =
              dragIdx !== null && overIdx === idx && dragIdx < idx;
            return (
              <li
                key={it.exerciseId}
                onDragOver={(e) => {
                  if (dragIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overIdx !== idx) setOverIdx(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null) move(dragIdx, idx);
                  setDragIdx(null);
                  setOverIdx(null);
                }}
              >
                <div
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(idx);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", it.exerciseId);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  className={cn(
                    "group bg-card my-0.5 flex items-center gap-2 rounded-md border py-1.5 pr-1 pl-1 transition-colors",
                    dragIdx === idx && "opacity-40",
                    dropBefore && "border-t-primary border-t-2",
                    dropAfter && "border-b-primary border-b-2",
                  )}
                >
                  <GripVertical
                    className="text-muted-foreground size-4 shrink-0 cursor-grab active:cursor-grabbing"
                    aria-hidden
                  />
                  <span className="text-muted-foreground w-5 shrink-0 text-right font-mono text-xs">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                      <span className="break-words">{it.title}</span>
                      <ShellBadge shell={it.shell} />
                      {it.kind === "LESSON" && <LessonBadge />}
                    </div>
                    <div className="text-muted-foreground truncate font-mono text-xs">
                      {it.slug}
                      {it.attempts > 0 &&
                        ` · ${it.attempts} attempt${it.attempts === 1 ? "" : "s"}`}
                    </div>
                  </div>

                  {it.kind === "LESSON" ? (
                    <span className="text-muted-foreground w-[4.5rem] text-center text-xs">
                      0 pts
                    </span>
                  ) : (
                    <div className="flex w-[4.5rem] items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        className="h-7 w-12 [appearance:textfield] px-1.5 text-right text-sm [&::-webkit-inner-spin-button]:appearance-none"
                        aria-label={`Points for ${it.title}`}
                        title={`Default: ${it.defaultPoints}`}
                        placeholder={String(it.defaultPoints)}
                        value={it.points}
                        onChange={(e) => patch(idx, { points: e.target.value })}
                      />
                      <span className="text-muted-foreground text-xs">pts</span>
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-pressed={it.gate}
                    aria-label="Must be done before the next ones"
                    title={
                      it.gate
                        ? "Following items stay locked until this one is solved (click to unlock)"
                        : "Click to lock the following items until this one is solved"
                    }
                    className={cn(
                      it.gate
                        ? "text-amber-400 hover:text-amber-300"
                        : "text-muted-foreground opacity-50 group-hover:opacity-100",
                    )}
                    onClick={() => patch(idx, { gate: !it.gate })}
                  >
                    {it.gate ? <Lock /> : <LockOpen />}
                  </Button>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={idx === 0}
                      onClick={() => move(idx, idx - 1)}
                      className="text-muted-foreground hover:text-foreground rounded disabled:opacity-20"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={last}
                      onClick={() => move(idx, idx + 1)}
                      className="text-muted-foreground hover:text-foreground rounded disabled:opacity-20"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${it.title}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onChange(items.filter((_, i) => i !== idx))}
                  >
                    <X />
                  </Button>
                </div>

                {it.gate && !last && (
                  <div className="flex items-center gap-2 py-0.5 pl-9 text-[11px] text-amber-400/80">
                    <Lock className="size-3" />
                    <span>below unlocks once #{idx + 1} is solved</span>
                    <span className="h-px flex-1 bg-amber-400/20" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- library */

type ShellFilter = "ALL" | "BASH" | "PWSH";
type KindFilter = "ALL" | "EXERCISE" | "LESSON";

function Library({
  added,
  onToggle,
  onAddMany,
}: {
  added: Set<string>;
  onToggle: (ex: LibraryRow) => void;
  onAddMany: (rows: LibraryRow[]) => void;
}) {
  const [q, setQ] = useState("");
  const [shell, setShell] = useState<ShellFilter>("ALL");
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [tag, setTag] = useState<string | null>(null);
  const [hideAdded, setHideAdded] = useState(false);

  const list = api.exercise.list.useQuery(
    {
      q: q.trim() || undefined,
      shell: shell === "ALL" ? undefined : shell,
      kind: kind === "ALL" ? undefined : kind,
    },
    { placeholderData: (prev) => prev },
  );

  const all = useMemo(() => [...(list.data ?? [])].sort(byTitle), [list.data]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ex of all)
      for (const t of ex.tags)
        if (!NOISE_TAGS.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 14)
      .map(([t]) => t);
  }, [all]);

  const rows = all.filter(
    (ex) => (!tag || ex.tags.includes(tag)) && !(hideAdded && added.has(ex.id)),
  );
  const addable = rows.filter((ex) => !added.has(ex.id));

  return (
    <section className="flex min-w-0 flex-col gap-2 lg:border-l lg:pl-4">
      <div className="flex h-9 items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Library</h3>
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="accent-primary size-3.5"
            checked={hideAdded}
            onChange={(e) => setHideAdded(e.target.checked)}
          />
          Hide added
        </label>
      </div>

      <div className="relative">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
        <Input
          placeholder="Search title, slug or tag…  (Enter adds the first match)"
          className="pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && addable[0]) {
              e.preventDefault();
              onToggle(addable[0]);
            }
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={shell}
          onChange={setShell}
          options={[
            ["ALL", "All"],
            ["BASH", "bash"],
            ["PWSH", "pwsh"],
          ]}
        />
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            ["ALL", "All"],
            ["EXERCISE", "Exercises"],
            ["LESSON", "Lessons"],
          ]}
        />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs transition-colors",
                tag === t
                  ? "border-primary bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="flex h-[26rem] flex-col gap-1 overflow-y-auto rounded-md border p-1">
        {list.isLoading && (
          <span className="text-muted-foreground p-2 text-sm">Loading…</span>
        )}
        {!list.isLoading && rows.length === 0 && (
          <span className="text-muted-foreground p-2 text-sm">
            {all.length > 0 ? (
              "Nothing matches these filters."
            ) : (
              <>
                No exercises found.{" "}
                <Link
                  href="/admin/exercises/new"
                  className="text-primary underline"
                >
                  Create one
                </Link>
                .
              </>
            )}
          </span>
        )}
        {rows.map((ex) => {
          const on = added.has(ex.id);
          const extraTags = ex.tags.filter((t) => !NOISE_TAGS.has(t));
          return (
            <button
              key={ex.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(ex)}
              title={on ? "Click to remove" : "Click to add"}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                on
                  ? "border-primary/40 bg-primary/10"
                  : "hover:bg-muted/60 border-transparent",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground group-hover:border-foreground group-hover:text-foreground",
                )}
              >
                {on ? (
                  <Check className="size-3.5" />
                ) : (
                  <Plus className="size-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 text-sm">
                  <span className="truncate">{ex.title}</span>
                  <ShellBadge shell={ex.shell} />
                  {ex.kind === "LESSON" && <LessonBadge />}
                </div>
                <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="shrink-0">
                    {ex.kind !== "LESSON" && `${ex.points} pts · `}
                    {ex.stepCount} step{ex.stepCount === 1 ? "" : "s"}
                  </span>
                  {extraTags.slice(0, 4).map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          {rows.length} shown
          {list.isFetching && !list.isLoading && " · updating…"}
        </span>
        {addable.length > 1 && (
          <Button variant="ghost" size="xs" onClick={() => onAddMany(addable)}>
            <Plus /> Add all {addable.length}
          </Button>
        )}
      </div>
    </section>
  );
}
