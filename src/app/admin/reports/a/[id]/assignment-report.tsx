"use client";

import {
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  ClipboardX,
  Download,
  Pencil,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDateTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/react";

type Data = RouterOutputs["report"]["assignment"];
type Cell = Data["rows"][number]["cells"][number];
type Mode = "points" | "checks" | "time";

export function AssignmentReport({ data }: { data: Data }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("points");
  const { assignment: a, items, rows, stats, summary, maxPoints } = data;

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
          <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
            <RefreshCw /> Refresh
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/assignments/${a.id}`}>
              <Pencil /> Edit
            </Link>
          </Button>
          <Button size="sm" onClick={() => downloadCsv(data)}>
            <Download /> CSV
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
          {!a.published && <Badge variant="outline">draft</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Students" value={summary.students} />
        <Stat
          label="Started"
          value={`${summary.started}/${summary.students}`}
        />
        <Stat
          label="All solved"
          value={`${summary.fullySolved}/${summary.students}`}
        />
        <Stat
          label="Avg. points"
          value={`${summary.avgPoints.toFixed(1)} / ${maxPoints}`}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Results</CardTitle>
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
                    <div className="text-muted-foreground text-xs">
                      {r.groups.join(", ")}
                      {!r.targeted && " · not targeted anymore"}
                      {r.extraMinutes ? ` · +${r.extraMinutes} min` : ""}
                      {!r.student.lastLoginAt && " · never signed in"}
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
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={items.length + 2}
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
    </div>
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
      title={`${passed ? "Solved" : "Started"}${steps} · ${cell.score ?? 0}/${points} pts · ${cell.checks} checks · ${cell.hintsUsed} hints · ${cell.resets} resets · ${cell.commands} commands${cell.pasteAttempts ? ` · ${cell.pasteAttempts} blocked paste attempts` : ""}`}
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
function downloadCsv(data: Data) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Name",
    "Email",
    "Groups",
    ...data.items.map((it, i) => `${i + 1}. ${it.title} (${it.points})`),
    "Total",
    "Max",
  ];
  const lines = data.rows.map((r) => [
    r.student.name,
    r.student.email,
    r.groups.join(", "),
    ...r.cells.map((c) => (c ? (c.score ?? 0) : "")),
    r.total,
    data.maxPoints,
  ]);
  const csv = [header, ...lines].map((l) => l.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${data.assignment.className}-${data.assignment.title}`
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .concat(".csv");
  link.click();
  URL.revokeObjectURL(url);
}
