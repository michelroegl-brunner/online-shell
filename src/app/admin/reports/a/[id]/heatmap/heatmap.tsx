"use client";

import { ChevronDown, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type Data = RouterOutputs["insights"]["heatmap"];
type StepRow = Data["items"][number]["steps"][number];

/**
 * Where the class is stuck, step by step. Each row is a bar: solved
 * (green), stuck here (amber; brighter = more), not there yet (grey).
 * Opening a row shows who is stuck and what goes wrong most often.
 */
export function Heatmap({ initial }: { initial: Data }) {
  const [auto, setAuto] = useState(true);
  const query = api.insights.heatmap.useQuery(
    { assignmentId: initial.assignment.id },
    {
      initialData: initial,
      refetchInterval: auto ? 15_000 : false,
      refetchOnWindowFocus: true,
    },
  );
  const data = query.data ?? initial;
  const { assignment: a, students, items } = data;
  const hottest = Math.max(
    1,
    ...items.flatMap((i) => i.steps.map((s) => s.stuck.length)),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/admin/reports/a/${a.id}`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> {a.title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-semibold">Heatmap</h1>
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
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
        </div>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          {a.className} · {students} students. Per step: who solved it, who is
          stuck on it right now (it&apos;s the first step they haven&apos;t
          solved), and who hasn&apos;t got there yet. Open a step to see who
          needs help and the most common failing checks and commands, so you
          know what to explain again.
        </p>
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-4 text-xs">
          <Swatch cls="bg-primary/70" label="solved" />
          <Swatch cls="bg-amber-500" label="stuck here" />
          <Swatch cls="bg-muted" label="not there yet" />
          <span>● working right now (last 15 min)</span>
        </div>
      </div>

      {items.map((item, i) => (
        <section key={item.id} className="flex flex-col gap-2">
          <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-semibold">
            {i + 1}. {item.title}
            <span className="text-muted-foreground text-xs font-normal">
              {item.started}/{students} started
              {item.kind === "LESSON" && " · lesson"}
            </span>
          </h2>
          <Card className="py-0">
            <CardContent className="divide-y p-0">
              {item.steps.map((s, j) => (
                <StepBar
                  key={s.id}
                  step={s}
                  index={j}
                  multi={item.steps.length > 1}
                  students={students}
                  hottest={hottest}
                />
              ))}
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}

function StepBar({
  step: s,
  index,
  multi,
  students,
  hottest,
}: {
  step: StepRow;
  index: number;
  multi: boolean;
  students: number;
  hottest: number;
}) {
  const [open, setOpen] = useState(false);
  const total = Math.max(1, students, s.passed + s.stuck.length);
  const pct = (n: number) => `${(n / total) * 100}%`;
  const active = s.stuck.filter((x) => x.active).length;
  // Heat: how this step's crowd compares to the worst step.
  const heat = s.stuck.length / hottest;
  const hasDetails =
    s.stuck.length > 0 ||
    s.topCheckMessages.length > 0 ||
    s.topFailingCommands.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasDetails}
        className="hover:bg-muted/30 grid w-full grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-left disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="truncate text-sm">
          {multi && (
            <span className="text-muted-foreground">{index + 1}. </span>
          )}
          {s.title}
        </span>
        <span className="bg-muted flex h-5 overflow-hidden rounded">
          <span className="bg-primary/70" style={{ width: pct(s.passed) }} />
          <span
            className="bg-amber-500"
            style={{
              width: pct(s.stuck.length),
              opacity: s.stuck.length ? 0.45 + 0.55 * heat : 0,
            }}
          />
        </span>
        <span className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-primary w-10 text-right">{s.passed} ✓</span>
          <span
            className={cn(
              "w-16 text-right",
              s.stuck.length ? "text-amber-400" : "text-muted-foreground",
            )}
          >
            {s.stuck.length} stuck
            {active > 0 && <span title="working right now"> ●{active}</span>}
          </span>
          <span className="text-muted-foreground w-12 text-right">
            {s.failedChecks}✗
          </span>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 transition-transform",
              open && "rotate-180",
              !hasDetails && "invisible",
            )}
          />
        </span>
      </button>

      {open && hasDetails && (
        <div className="bg-muted/20 grid gap-4 px-4 pt-1 pb-4 text-sm md:grid-cols-3">
          <div>
            <Label>Stuck here</Label>
            {s.stuck.length === 0 ? (
              <p className="text-muted-foreground text-xs">Nobody.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {s.stuck.map((x) => (
                  <li key={x.attemptId} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        x.active ? "bg-amber-400" : "bg-muted-foreground/30",
                      )}
                    />
                    <Link
                      href={`/admin/reports/attempt/${x.attemptId}`}
                      className="hover:text-primary flex-1 truncate"
                    >
                      {x.name}
                    </Link>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {x.minutes} min · {x.checks} checks · {x.hints} hints
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label>Most common check messages</Label>
            {s.topCheckMessages.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No failed checks logged.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.topCheckMessages.map((m) => (
                  <li key={m.text} className="flex gap-2">
                    <span className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums">
                      {m.count}×
                    </span>
                    <span className="text-xs break-words">{m.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label>Failing commands (of those stuck)</Label>
            {s.topFailingCommands.length === 0 ? (
              <p className="text-muted-foreground text-xs">None.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.topFailingCommands.map((m) => (
                  <li key={m.text} className="flex gap-2">
                    <span className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums">
                      {m.count}×
                    </span>
                    <code className="font-mono text-xs break-all text-red-400">
                      {m.text}
                    </code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1.5 text-xs tracking-wide uppercase">
      {children}
    </div>
  );
}

function Swatch({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-4 rounded-sm", cls)} /> {label}
    </span>
  );
}
