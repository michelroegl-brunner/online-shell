"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

/**
 * Session replay: the attempt's commands, checks, hints, resets and focus /
 * paste events merged into one timeline, played back like a recording.
 * The side panel shows each step's state at the current moment.
 */

type Command = {
  id: string;
  at: Date;
  exitCode: number | null;
  cwd: string;
  command: string;
};
type Activity = {
  id: string;
  at: Date;
  type: string;
  stepId: string | null;
  ok: boolean | null;
  detail: string | null;
};
type Focus = { id: string; at: Date; type: string; seconds: number | null };
type Paste = { id: string; at: Date; count: number };
type Step = { id: string; index: number; title: string; hintCount: number };

type Ev =
  | { key: string; t: number; kind: "cmd"; c: Command }
  | { key: string; t: number; kind: "act"; a: Activity }
  | { key: string; t: number; kind: "focus"; f: Focus }
  | { key: string; t: number; kind: "paste"; p: Paste };

const SPEEDS = [
  { label: "×10", factor: 10 },
  { label: "×60", factor: 60 },
  { label: "×300", factor: 300 },
] as const;

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Markers on the timeline bar (commands are too many to mark). */
function markerClass(e: Ev): string | null {
  if (e.kind === "focus") return "bg-neutral-400";
  if (e.kind === "paste") return "bg-red-500";
  if (e.kind !== "act") return null;
  switch (e.a.type) {
    case "CHECK":
    case "AUTOCHECK":
      return e.a.ok ? "bg-primary" : "bg-red-400";
    case "HINT":
      return "bg-amber-400";
    case "RESET":
    case "SETUP":
      return "bg-sky-400";
    default:
      return null;
  }
}

export function SessionReplay({
  commands,
  activity,
  focusEvents,
  pasteEvents,
  steps,
}: {
  commands: Command[];
  activity: Activity[];
  focusEvents: Focus[];
  pasteEvents: Paste[];
  steps: Step[];
}) {
  const events = useMemo<Ev[]>(() => {
    const all: Ev[] = [
      ...commands.map((c) => ({
        key: `c${c.id}`,
        t: new Date(c.at).getTime(),
        kind: "cmd" as const,
        c,
      })),
      ...activity.map((a) => ({
        key: `a${a.id}`,
        t: new Date(a.at).getTime(),
        kind: "act" as const,
        a,
      })),
      ...focusEvents.map((f) => ({
        key: `f${f.id}`,
        t: new Date(f.at).getTime(),
        kind: "focus" as const,
        f,
      })),
      ...pasteEvents.map((p) => ({
        key: `p${p.id}`,
        t: new Date(p.at).getTime(),
        kind: "paste" as const,
        p,
      })),
    ];
    return all.sort((x, y) => x.t - y.t);
  }, [commands, activity, focusEvents, pasteEvents]);

  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const feedRef = useRef<HTMLDivElement>(null);
  const n = events.length;
  const last = n - 1;

  // Playing stops by itself at the end.
  const running = playing && pos < last;

  // Playback: wait (scaled) as long as the student did, within limits.
  useEffect(() => {
    if (!running) return;
    const gap = events[pos + 1]!.t - events[pos]!.t;
    const delay = Math.min(1500, Math.max(120, gap / SPEEDS[speed]!.factor));
    const id = setTimeout(() => setPos((p) => Math.min(last, p + 1)), delay);
    return () => clearTimeout(id);
  }, [running, pos, last, events, speed]);

  // Keep the newest line in view.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pos]);

  // Step states at the current position.
  const state = useMemo(() => {
    const s = new Map(
      steps.map((st) => [
        st.id,
        { checks: 0, hints: 0, passed: false, lastOk: null as boolean | null },
      ]),
    );
    let lastCheck: Activity | null = null;
    for (let i = 0; i <= pos && i < n; i++) {
      const e = events[i]!;
      if (e.kind !== "act" || !e.a.stepId) continue;
      const row = s.get(e.a.stepId);
      if (!row) continue;
      if (e.a.type === "CHECK" || e.a.type === "AUTOCHECK") {
        row.checks += 1;
        row.lastOk = e.a.ok;
        if (e.a.ok) row.passed = true;
        lastCheck = e.a;
      } else if (e.a.type === "HINT") {
        row.hints += 1;
      }
    }
    return { steps: s, lastCheck };
  }, [events, pos, n, steps]);

  if (n === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session replay</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  const t0 = events[0]!.t;
  const span = Math.max(1, events[last]!.t - t0);
  const cur = events[pos]!;
  const elapsed = cur.t - t0;
  const stepTitle = (id: string | null) => {
    const st = steps.find((x) => x.id === id);
    return st ? `${st.index + 1}. ${st.title}` : "step";
  };
  // The feed shows the last 300 entries up to the current one.
  const shown = events.slice(Math.max(0, pos - 299), pos + 1);
  const noActivityLog = activity.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Session replay
          <span className="text-muted-foreground text-xs font-normal">
            {n} events · {formatSpan(span)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="@container flex flex-col gap-3">
        {noActivityLog && (
          <p className="text-muted-foreground text-xs">
            Only commands were recorded for this attempt (checks and hints are
            logged since the replay feature exists).
          </p>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Back to the start"
            onClick={() => {
              setPlaying(false);
              setPos(0);
            }}
          >
            <SkipBack />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous event"
            onClick={() => setPos((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (running) {
                setPlaying(false);
                return;
              }
              if (pos >= last) setPos(0);
              setPlaying(true);
            }}
          >
            {running ? <Pause /> : <Play />}
            {running ? "Pause" : pos >= last ? "Replay" : "Play"}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next event"
            onClick={() => setPos((p) => Math.min(last, p + 1))}
          >
            <ChevronRight />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Jump to the end"
            onClick={() => {
              setPlaying(false);
              setPos(last);
            }}
          >
            <SkipForward />
          </Button>
          <div className="ml-2 flex items-center gap-1">
            {SPEEDS.map((s, i) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSpeed(i)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs tabular-nums",
                  i === speed
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {timeFmt.format(new Date(cur.t))} · +{formatSpan(elapsed)} ·{" "}
            {pos + 1}/{n}
          </span>
        </div>

        {/* Timeline with markers */}
        <div
          className="relative h-6 cursor-pointer"
          title="Click to jump"
          onClick={(ev) => {
            // Jump to the last event at or before the clicked time.
            const r = ev.currentTarget.getBoundingClientRect();
            const t =
              t0 + ((ev.clientX - r.left) / Math.max(1, r.width)) * span;
            let i = 0;
            while (i < last && events[i + 1]!.t <= t) i++;
            setPlaying(false);
            setPos(i);
          }}
        >
          <div className="bg-muted absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded" />
          <div
            className="bg-primary/40 absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded"
            style={{ width: `${(elapsed / span) * 100}%` }}
          />
          {events.map((e, i) => {
            const cls = markerClass(e);
            if (!cls) return null;
            return (
              <button
                key={e.key}
                type="button"
                title={`${timeFmt.format(new Date(e.t))} ${describe(e, stepTitle)}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPlaying(false);
                  setPos(i);
                }}
                className={cn(
                  "absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--card)]",
                  cls,
                )}
                style={{ left: `${((e.t - t0) / span) * 100}%` }}
              />
            );
          })}
          <div
            className="bg-foreground pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded"
            style={{ left: `${(elapsed / span) * 100}%` }}
          />
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-3 text-[11px]">
          <Legend cls="bg-primary" label="check passed" />
          <Legend cls="bg-red-400" label="check failed" />
          <Legend cls="bg-amber-400" label="hint" />
          <Legend cls="bg-sky-400" label="setup / reset" />
          <Legend cls="bg-neutral-400" label="left the window" />
          <Legend cls="bg-red-500" label="paste blocked" />
        </div>

        <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_16rem]">
          {/* Feed */}
          <div
            ref={feedRef}
            className="h-80 overflow-auto rounded-md bg-[#0a0a0a] px-3 py-2 font-mono text-xs leading-6"
          >
            {shown.map((e, i) => {
              const prev = i > 0 ? shown[i - 1] : null;
              const gapMin = prev ? (e.t - prev.t) / 60_000 : 0;
              const isCur = e.key === cur.key;
              return (
                <div key={e.key}>
                  {gapMin >= 10 && (
                    <div className="text-muted-foreground/60 my-1 text-center">
                      · · · {Math.round(gapMin)} min pause · · ·
                    </div>
                  )}
                  <FeedLine e={e} current={isCur} stepTitle={stepTitle} />
                </div>
              );
            })}
          </div>

          {/* Step state at this moment */}
          <div className="flex flex-col gap-2">
            <ul className="divide-y rounded-md border text-sm">
              {steps.map((st) => {
                const s = state.steps.get(st.id)!;
                return (
                  <li key={st.id} className="flex items-start gap-2 px-3 py-2">
                    {s.passed ? (
                      <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" />
                    ) : s.checks > 0 || s.hints > 0 ? (
                      <CircleDot className="mt-0.5 size-4 shrink-0 text-amber-400" />
                    ) : (
                      <span className="text-muted-foreground/40 w-4 shrink-0 text-center">
                        ·
                      </span>
                    )}
                    <span className="flex-1">
                      <span className="block leading-tight">
                        {st.index + 1}. {st.title}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {s.checks} checks · {s.hints}/{st.hintCount} hints
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {state.lastCheck && (
              <div
                className={cn(
                  "rounded-md border p-2 text-xs",
                  state.lastCheck.ok
                    ? "border-primary/40"
                    : "border-destructive/40",
                )}
              >
                <div className="text-muted-foreground mb-1">
                  Last check ({stepTitle(state.lastCheck.stepId)})
                </div>
                <pre className="font-mono whitespace-pre-wrap">
                  {state.lastCheck.detail?.trim()
                    ? state.lastCheck.detail
                    : state.lastCheck.ok
                      ? "passed"
                      : "failed"}
                </pre>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedLine({
  e,
  current,
  stepTitle,
}: {
  e: Ev;
  current: boolean;
  stepTitle: (id: string | null) => string;
}) {
  const time = (
    <span className="text-muted-foreground/60 shrink-0">
      {timeFmt.format(new Date(e.t))}
    </span>
  );
  const row = cn(
    "flex gap-3 whitespace-pre rounded px-1 -mx-1",
    current && "bg-white/10",
  );
  if (e.kind === "cmd") {
    const failed = e.c.exitCode !== null && e.c.exitCode !== 0;
    return (
      <div className={row}>
        {time}
        <span className="shrink-0 text-sky-400">{e.c.cwd}$</span>
        <span
          className={cn("flex-1", failed ? "text-red-400" : "text-neutral-200")}
        >
          {e.c.command}
        </span>
        {failed && (
          <span className="shrink-0 text-red-400/80">exit {e.c.exitCode}</span>
        )}
      </div>
    );
  }
  const text = describe(e, stepTitle);
  const color =
    e.kind === "act"
      ? e.a.type === "HINT"
        ? "text-amber-400"
        : e.a.type === "RESET" || e.a.type === "SETUP"
          ? "text-sky-300"
          : e.a.ok
            ? "text-emerald-400"
            : "text-red-400"
      : e.kind === "paste"
        ? "text-red-400"
        : "text-neutral-400";
  const Icon =
    e.kind === "act" && e.a.type === "HINT"
      ? Lightbulb
      : e.kind === "act" && (e.a.type === "RESET" || e.a.type === "SETUP")
        ? RotateCcw
        : null;
  return (
    <div className={cn(row, color)}>
      {time}
      <span className="flex flex-1 items-center gap-1.5 italic">
        {Icon ? <Icon className="size-3" /> : <span>──</span>}
        {text}
      </span>
    </div>
  );
}

function describe(e: Ev, stepTitle: (id: string | null) => string) {
  switch (e.kind) {
    case "cmd":
      return e.c.command;
    case "focus":
      return `left the exam window${e.f.seconds !== null ? ` (${e.f.seconds} s)` : ""}`;
    case "paste":
      return `paste blocked${e.p.count > 1 ? ` ×${e.p.count}` : ""}`;
    case "act":
      switch (e.a.type) {
        case "CHECK":
          return `check ${stepTitle(e.a.stepId)}: ${e.a.ok ? "passed" : "not yet"}`;
        case "AUTOCHECK":
          return `${stepTitle(e.a.stepId)} solved (auto-check)`;
        case "HINT":
          return `hint ${e.a.detail ?? ""} for ${stepTitle(e.a.stepId)}${e.a.ok === false ? " (after solving)" : ""}`;
        case "RESET":
          return `reset the exercise folder${e.a.ok === false ? " (failed)" : ""}`;
        case "SETUP":
          return `exercise opened${e.a.ok === false ? " (setup failed)" : ""}`;
        default:
          return e.a.type.toLowerCase();
      }
  }
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-2 rounded-full", cls)} /> {label}
    </span>
  );
}

function formatSpan(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
