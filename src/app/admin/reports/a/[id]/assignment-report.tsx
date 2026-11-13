"use client";

import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  ClipboardX,
  Clock,
  Download,
  EyeOff,
  GitCompare,
  GraduationCap,
  Lock,
  MessageSquare,
  Pencil,
  Unlock,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatDateTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  DEFAULT_SCALE,
  GRADE_NAMES,
  type GradeScale,
  gradeFor,
  loadScale,
  saveScale,
} from "./grades";

type Data = RouterOutputs["report"]["assignment"];
type Row = Data["rows"][number];
type Cell = Row["cells"][number];
type Mode = "points" | "checks" | "time";

export function AssignmentReport({ initial }: { initial: Data }) {
  const [mode, setMode] = useState<Mode>("points");
  const [auto, setAuto] = useState(false);
  // Grades aren't rendered on the server (hidden until toggled), so
  // reading localStorage here can't cause a hydration mismatch.
  const [scale, setScale] = useState<GradeScale>(() =>
    typeof window === "undefined" ? DEFAULT_SCALE : loadScale(),
  );
  const [showGrades, setShowGrades] = useState(false);
  const [gradeDialog, setGradeDialog] = useState(false);
  const [extFor, setExtFor] = useState<Row | null>(null);

  const query = api.report.assignment.useQuery(
    { id: initial.assignment.id },
    {
      initialData: initial,
      refetchInterval: auto ? 10_000 : false,
      refetchOnWindowFocus: true,
    },
  );
  const data = query.data ?? initial;
  const { assignment: a, items, rows, stats, summary, maxPoints } = data;
  const exam = a.mode === "EXAM";
  const reopen = api.manage.reopenSubmission.useMutation({
    onSuccess: () => {
      toast.success("Exam reopened for this student");
      void query.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/reports"
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Reports
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">{a.title}</h1>
          <label
            className="text-muted-foreground flex items-center gap-2 text-sm"
            title="Reload the results every 10 seconds"
          >
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            Auto-refresh
            {query.isFetching && (
              <span className="bg-primary size-1.5 animate-pulse rounded-full" />
            )}
          </label>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/admin/reports/a/${a.id}/live`}>
              <Activity /> Live view
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/reports/a/${a.id}/solutions`}>
              <GitCompare /> Solutions
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/assignments/${a.id}`}>
              <Pencil /> Edit
            </Link>
          </Button>
        </div>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span>{a.className}</span>
          {a.groups.length > 0 ? (
            a.groups.map((g) => (
              <Badge key={g} variant="secondary">
                {g}
              </Badge>
            ))
          ) : (
            <span>· whole class</span>
          )}
          {a.dueAt && <span>· due {formatDateTime(a.dueAt)}</span>}
          {exam && <Badge variant="destructive">exam</Badge>}
          {!a.published &&
            (a.publishAt ? (
              <Badge variant="outline">
                scheduled {formatDateTime(a.publishAt)}
              </Badge>
            ) : (
              <Badge variant="outline">draft</Badge>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Students" value={summary.students} />
        <Stat
          label="Started"
          value={`${summary.started}/${summary.students}`}
        />
        <Stat
          label={exam ? "Handed in" : "All solved"}
          value={
            exam
              ? `${rows.filter((r) => r.targeted && r.submittedAt).length}/${summary.students}`
              : `${summary.fullySolved}/${summary.students}`
          }
        />
        <Stat
          label="Avg. points"
          value={`${summary.avgPoints.toFixed(1)} / ${maxPoints}`}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Results</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons
              data={data}
              scale={scale}
              onEditScale={() => setGradeDialog(true)}
            />
            <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={showGrades}
                onChange={(e) => setShowGrades(e.target.checked)}
              />
              Grades
            </label>
            <div className="bg-muted inline-flex rounded-md p-0.5 text-sm">
              {(
                [
                  ["points", "Points"],
                  ["checks", "Checks"],
                  ["time", "Time"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded px-3 py-1",
                    mode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="bg-card sticky left-0 px-4 py-2 text-left font-medium">
                  Student
                </th>
                {items.map((it, i) => (
                  <th
                    key={it.id}
                    className="px-2 py-2 text-center font-medium"
                    title={it.title}
                  >
                    <div className="mx-auto max-w-28 truncate">
                      {i + 1}. {it.title}
                    </div>
                    <div className="text-muted-foreground text-xs font-normal">
                      {it.points} pts
                    </div>
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">Total</th>
                {showGrades && (
                  <th
                    className="px-4 py-2 text-center font-medium"
                    title={`≥ ${scale.thresholds.join(" / ")} %`}
                  >
                    Grade
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.student.id}
                  className={cn(
                    "border-b last:border-0",
                    !r.targeted && "opacity-60",
                  )}
                >
                  <td className="bg-card sticky left-0 px-4 py-2">
                    <Link
                      href={`/admin/reports/student/${r.student.id}?classId=${a.classId}`}
                      className="hover:text-primary font-medium"
                    >
                      {r.student.name}
                    </Link>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-xs">
                      <span>
                        {r.groups.join(", ")}
                        {!r.targeted && " · not targeted anymore"}
                        {r.extraMinutes ? ` · +${r.extraMinutes} min` : ""}
                        {!r.student.lastLoginAt && " · never signed in"}
                      </span>
                      {r.submittedAt && (
                        <span
                          className="text-primary inline-flex items-center gap-0.5"
                          title={`Handed in ${formatDateTime(r.submittedAt)}`}
                        >
                          <Lock className="size-3" /> handed in
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex gap-1">
                      {a.dueAt && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
                          onClick={() => setExtFor(r)}
                          title="Give this student extra time"
                        >
                          <Clock className="size-3" /> time
                        </button>
                      )}
                      {r.submittedAt && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
                          disabled={reopen.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Reopen the exam for ${r.student.name}? They can continue working.`,
                              )
                            ) {
                              reopen.mutate({
                                assignmentId: a.id,
                                userId: r.student.id,
                              });
                            }
                          }}
                        >
                          <Unlock className="size-3" /> reopen
                        </button>
                      )}
                    </div>
                  </td>
                  {r.cells.map((c, i) => (
                    <td key={items[i]!.id} className="px-2 py-1.5 text-center">
                      <CellView
                        cell={c}
                        mode={mode}
                        points={items[i]!.points}
                        stepCount={items[i]!.stepCount}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {r.total}
                    <span className="text-muted-foreground font-normal">
                      /{maxPoints}
                    </span>
                  </td>
                  {showGrades && (
                    <td className="px-4 py-2 text-center tabular-nums">
                      <GradeView grade={gradeFor(r.total, maxPoints, scale)} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={items.length + (showGrades ? 3 : 2)}
                    className="text-muted-foreground px-4 py-8 text-center"
                  >
                    No students in this class/group yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Per exercise</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((it, i) => {
            const s = stats[i]!;
            return (
              <Card key={it.id}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {i + 1}. {it.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full"
                        style={{ width: `${Math.round(s.passRate * 100)}%` }}
                      />
                    </div>
                    <span className="tabular-nums">
                      {Math.round(s.passRate * 100)}% solved
                    </span>
                  </div>
                  <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1">
                    <span>Started</span>
                    <span className="text-foreground">{s.started}</span>
                    <span>Median time to solve</span>
                    <span className="text-foreground">
                      {s.medianMinutes === null
                        ? "—"
                        : formatMinutes(s.medianMinutes)}
                    </span>
                    <span>Avg. checks to solve</span>
                    <span className="text-foreground">
                      {s.avgChecksToPass === null
                        ? "—"
                        : s.avgChecksToPass.toFixed(1)}
                    </span>
                    <span>Hints used</span>
                    <span className="text-foreground">{s.hintsUsed}</span>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                      Most common failing commands
                    </div>
                    {s.topFailing.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        None recorded.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {s.topFailing.map((f) => (
                          <li
                            key={f.command}
                            className="flex items-start gap-2"
                          >
                            <code className="bg-muted/60 flex-1 truncate rounded px-1.5 py-0.5 font-mono text-xs">
                              {f.command}
                            </code>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              ×{f.count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <ExtensionDialog
        key={extFor?.student.id ?? "none"}
        assignmentId={a.id}
        row={extFor}
        onClose={() => setExtFor(null)}
        onSaved={() => void query.refetch()}
      />
      <GradeScaleDialog
        key={gradeDialog ? "open" : "closed"}
        open={gradeDialog}
        scale={scale}
        onClose={() => setGradeDialog(false)}
        onSave={(s) => {
          setScale(s);
          saveScale(s);
          setShowGrades(true);
          setGradeDialog(false);
        }}
      />
    </div>
  );
}

function GradeView({ grade }: { grade: number | null }) {
  if (grade === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      title={GRADE_NAMES[grade]}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold",
        grade <= 2
          ? "bg-primary/15 text-primary"
          : grade <= 4
            ? "bg-amber-500/10 text-amber-400"
            : "bg-red-500/10 text-red-400",
      )}
    >
      {grade}
    </span>
  );
}

function ExportButtons({
  data,
  scale,
  onEditScale,
}: {
  data: Data;
  scale: GradeScale;
  onEditScale: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => downloadCsv(data, "points", scale)}
        title="Points per exercise"
      >
        <Download /> CSV
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => downloadCsv(data, "steps", scale)}
        title="Points per step"
      >
        per step
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => downloadCsv(data, "grades", scale)}
        title="Total, percent and grade"
      >
        grades
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={onEditScale}
        aria-label="Grade scale"
        title="Grade scale"
      >
        <GraduationCap />
      </Button>
    </div>
  );
}

function ExtensionDialog({
  assignmentId,
  row,
  onClose,
  onSaved,
}: {
  assignmentId: string;
  row: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Remounted per student (key), so this starts from their extension.
  const [minutes, setMinutes] = useState(
    row?.extraMinutes ? String(row.extraMinutes) : "",
  );
  const save = api.manage.setExtension.useMutation({
    onSuccess: (_, v) => {
      toast.success(
        v.extraMinutes ? `+${v.extraMinutes} min saved` : "Extension removed",
      );
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const submit = (n: number) => {
    if (!row) return;
    if (!Number.isInteger(n) || n < 0)
      return toast.error("Whole minutes, please.");
    save.mutate({ assignmentId, userId: row.student.id, extraMinutes: n });
  };
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Extra time</DialogTitle>
          <DialogDescription>
            {row?.student.name}: moves the due time for this student only.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {[5, 10, 15, 30, 60].map((n) => (
            <Button
              key={n}
              size="sm"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => submit((row?.extraMinutes ?? 0) + n)}
            >
              +{n} min
            </Button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(Number(minutes || 0));
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="ext">Total extra minutes</Label>
            <Input
              id="ext"
              type="number"
              min={0}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="0 = none"
            />
          </div>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GradeScaleDialog({
  open,
  scale,
  onClose,
  onSave,
}: {
  open: boolean;
  scale: GradeScale;
  onClose: () => void;
  onSave: (s: GradeScale) => void;
}) {
  // Remounted on open (key), so edits start from the saved scale.
  const [t, setT] = useState(scale.thresholds.map(String));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Grade scale</DialogTitle>
          <DialogDescription>
            Minimum percent of the points for each grade. Saved in this browser.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = t.map(Number);
            const ok =
              n.every((x) => Number.isFinite(x) && x >= 0 && x <= 100) &&
              n.every((x, i) => i === 0 || x < n[i - 1]!);
            if (!ok) {
              return toast.error("Use 0–100, each lower than the one above.");
            }
            onSave({ thresholds: n as GradeScale["thresholds"] });
          }}
        >
          {[1, 2, 3, 4].map((g, i) => (
            <div key={g} className="flex items-center gap-3">
              <Label className="w-32">
                {g} – {GRADE_NAMES[g]}
              </Label>
              <span className="text-muted-foreground text-sm">≥</span>
              <Input
                type="number"
                step="0.5"
                className="w-24"
                value={t[i]}
                onChange={(e) =>
                  setT((x) => x.map((v, j) => (j === i ? e.target.value : v)))
                }
              />
              <span className="text-muted-foreground text-sm">%</span>
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            Below the last value: 5 – {GRADE_NAMES[5]}.
          </p>
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setT(DEFAULT_SCALE.thresholds.map(String))}
            >
              Default
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function CellView({
  cell,
  mode,
  points,
  stepCount,
}: {
  cell: Cell;
  mode: Mode;
  points: number;
  stepCount: number;
}) {
  if (!cell) return <span className="text-muted-foreground/40">·</span>;
  const passed = cell.status === "PASSED";
  const steps =
    stepCount > 1 ? ` · ${cell.stepsPassed}/${stepCount} steps` : "";
  const text =
    mode === "points"
      ? `${cell.score ?? 0}${stepCount > 1 && !passed ? ` (${cell.stepsPassed}/${stepCount})` : ""}`
      : mode === "checks"
        ? `${cell.checks}✓${cell.hintsUsed ? ` ${cell.hintsUsed}💡` : ""}`
        : cell.minutes === null
          ? "—"
          : formatMinutes(cell.minutes);
  return (
    <Link
      href={`/admin/reports/attempt/${cell.attemptId}`}
      title={`${passed ? "Solved" : "Started"}${steps} · ${cell.score ?? 0}/${points} pts · ${cell.checks} checks · ${cell.hintsUsed} hints · ${cell.resets} resets · ${cell.commands} commands${cell.pasteAttempts ? ` · ${cell.pasteAttempts} blocked paste attempts` : ""}${cell.focusLost ? ` · left the exam window ${cell.focusLost}×` : ""}${cell.scoreOverridden ? " · manual points" : ""}${cell.extraChecks ? ` · +${cell.extraChecks} checks` : ""}`}
      className={cn(
        "inline-flex min-w-14 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs tabular-nums",
        passed
          ? "bg-primary/15 text-primary hover:bg-primary/25"
          : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
      )}
    >
      {passed ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <CircleDot className="size-3.5" />
      )}
      {text}
      {cell.scoreOverridden && (
        <Pencil className="size-3 opacity-70" aria-label="manual points" />
      )}
      {cell.hasFeedback && (
        <MessageSquare className="size-3 opacity-70" aria-label="feedback" />
      )}
      {cell.focusLost > 0 && (
        <span className="ml-0.5 inline-flex items-center gap-0.5 text-amber-400">
          <EyeOff className="size-3.5" />
          {cell.focusLost}
        </span>
      )}
      {cell.pasteAttempts > 0 && (
        <span className="ml-0.5 inline-flex items-center gap-0.5 text-red-400">
          <ClipboardX className="size-3.5" />
          {cell.pasteAttempts}
        </span>
      )}
    </Link>
  );
}

function formatMinutes(m: number) {
  if (m < 1) return "<1 min";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${Math.round(m % 60)} min`;
}

/** Semicolon CSV with BOM so Excel (de-AT) opens it correctly. */
function downloadCsv(
  data: Data,
  kind: "points" | "steps" | "grades",
  scale: GradeScale,
) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (n: number) => String(n).replace(".", ",");
  const base = ["Name", "Email", "Groups"];
  let header: string[];
  let lines: (string | number)[][];
  if (kind === "steps") {
    header = [
      ...base,
      ...data.items.flatMap((it, i) =>
        it.steps.length > 1
          ? it.steps.map(
              (st, j) => `${i + 1}.${j + 1} ${st.title} (${st.points})`,
            )
          : [`${i + 1}. ${it.title} (${it.points})`],
      ),
      "Total",
      "Max",
    ];
    lines = data.rows.map((r) => [
      r.student.name,
      r.student.email,
      r.groups.join(", "),
      ...data.items.flatMap((it, i) => {
        const c = r.cells[i];
        if (it.steps.length <= 1) return [c ? (c.score ?? 0) : ""];
        // Manual points can't be split into steps: show them on the first.
        if (c?.scoreOverridden) {
          return it.steps.map((_, j) => (j === 0 ? (c.score ?? 0) : ""));
        }
        return it.steps.map((st) =>
          c ? (c.passedStepIds.includes(st.id) ? st.points : 0) : "",
        );
      }),
      r.total,
      data.maxPoints,
    ]);
  } else if (kind === "grades") {
    header = [...base, "Points", "Max", "Percent", "Grade", "Grade (text)"];
    lines = data.rows.map((r) => {
      const g = gradeFor(r.total, data.maxPoints, scale);
      return [
        r.student.name,
        r.student.email,
        r.groups.join(", "),
        r.total,
        data.maxPoints,
        data.maxPoints
          ? num(Math.round((r.total / data.maxPoints) * 1000) / 10)
          : "",
        g ?? "",
        g ? GRADE_NAMES[g]! : "",
      ];
    });
  } else {
    header = [
      ...base,
      ...data.items.map((it, i) => `${i + 1}. ${it.title} (${it.points})`),
      "Total",
      "Max",
    ];
    lines = data.rows.map((r) => [
      r.student.name,
      r.student.email,
      r.groups.join(", "),
      ...r.cells.map((c) => (c ? (c.score ?? 0) : "")),
      r.total,
      data.maxPoints,
    ]);
  }
  const csv = [header, ...lines].map((l) => l.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    `${data.assignment.className}-${data.assignment.title}${kind === "points" ? "" : `-${kind}`}`
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .concat(".csv");
  link.click();
  URL.revokeObjectURL(url);
}
