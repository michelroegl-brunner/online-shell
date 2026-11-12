"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { WindowBadge } from "~/components/learn/badges";
import { Markdown } from "~/components/markdown";
import { ShellTerminal } from "~/components/terminal/shell-terminal";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type Item = RouterOutputs["learn"]["item"];
type Step = Item["steps"][number];
type CheckResult = { ok: boolean; output: string };

export function Workspace({ initial }: { initial: Item }) {
  const utils = api.useUtils();
  const { data } = api.learn.item.useQuery(
    { itemId: initial.itemId },
    { initialData: initial, refetchOnWindowFocus: false },
  );
  const item = data ?? initial;
  const { assignment, exercise, attempt, position, steps } = item;
  const open = assignment.state === "open";

  const [ready, setReady] = useState(Boolean(attempt?.prepared));
  const [prepError, setPrepError] = useState<string | null>(null);
  const [termKey, setTermKey] = useState(0);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmReset, setConfirmReset] = useState(false);

  const start = api.learn.start.useMutation();
  const check = api.learn.check.useMutation();
  const hint = api.learn.hint.useMutation();
  const reset = api.learn.reset.useMutation();

  // The step to work on: first open step that isn't solved yet.
  const current =
    steps.find((s) => s.unlocked && s.status !== "PASSED") ?? null;
  const isExpanded = (s: Step) => expanded[s.id] ?? s.id === current?.id;

  // Prepare the exercise folder once when the page opens.
  const started = useRef(false);
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    start
      .mutateAsync({ itemId: item.itemId })
      .then(async (r) => {
        if (r.prepared) {
          setReady(true);
          await utils.learn.item.invalidate({ itemId: item.itemId });
        } else {
          setPrepError(r.output);
        }
      })
      .catch((e: Error) => setPrepError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.itemId]);

  async function refresh() {
    await Promise.all([
      utils.learn.item.invalidate({ itemId: item.itemId }),
      utils.learn.assignment.invalidate(),
      utils.learn.overview.invalidate(),
    ]);
  }

  async function runCheck(step: Step) {
    try {
      const r = await check.mutateAsync({
        itemId: item.itemId,
        stepId: step.id,
      });
      setResults((m) => ({ ...m, [step.id]: { ok: r.ok, output: r.output } }));
      if (r.exerciseSolved && r.ok) toast.success("Exercise solved! 🎉");
      else if (r.ok) toast.success(`Step ${step.index + 1} solved!`);
      // Let the next step open itself.
      if (r.ok) setExpanded((m) => ({ ...m, [step.id]: false }));
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function showHint(step: Step) {
    try {
      await hint.mutateAsync({ itemId: item.itemId, stepId: step.id });
      await utils.learn.item.invalidate({ itemId: item.itemId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function runReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    try {
      const r = await reset.mutateAsync({ itemId: item.itemId });
      if (!r.ok) {
        toast.error(r.output);
        return;
      }
      toast.success("Exercise folder reset");
      setResults({});
      setTermKey((k) => k + 1); // the folder was recreated: new shell in it
      await utils.learn.item.invalidate({ itemId: item.itemId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const solved = attempt?.status === "PASSED";
  const stepsPassed = steps.filter((s) => s.status === "PASSED").length;
  const multi = steps.length > 1;
  const base = `/learn/a/${assignment.id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* ── Task ── */}
      <section className="flex flex-col gap-4 overflow-y-auto border-b p-4 sm:p-6 lg:w-[44%] lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-2 text-sm">
          <Link
            href={base}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-4" /> {assignment.title}
          </Link>
          <span className="text-muted-foreground">
            {position.index + 1} / {position.total}
          </span>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{exercise.title}</h1>
            {solved && (
              <Badge className="bg-primary/15 text-primary border-primary/30">
                <CheckCircle2 /> solved
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary" className="font-mono">
              {exercise.shell === "BASH" ? "bash" : "pwsh"}
            </Badge>
            <span>
              {attempt?.score ?? 0}/{exercise.points} points
            </span>
            {multi && (
              <span>
                · {stepsPassed}/{steps.length} steps
              </span>
            )}
            <WindowBadge state={assignment.state} dueAt={assignment.dueAt} />
          </div>
        </div>

        {exercise.description && <Markdown>{exercise.description}</Markdown>}

        <p className="text-muted-foreground text-xs">
          Your files are in{" "}
          <code className="font-mono">~/exercises/{exercise.slug}</code>
          {multi && " — all steps work in this folder"}.
        </p>

        <ol className="flex flex-col gap-3">
          {steps.map((s) => (
            <StepCard
              key={s.id}
              step={s}
              multi={multi}
              expanded={isExpanded(s)}
              isCurrent={s.id === current?.id}
              onToggle={() =>
                s.unlocked &&
                setExpanded((m) => ({ ...m, [s.id]: !isExpanded(s) }))
              }
              result={
                results[s.id] ??
                (s.lastCheckOutput !== null
                  ? { ok: s.status === "PASSED", output: s.lastCheckOutput }
                  : null)
              }
              canAct={open && ready}
              allowHints={assignment.allowHints}
              maxChecks={assignment.maxChecks}
              checking={check.isPending && check.variables?.stepId === s.id}
              anyChecking={check.isPending}
              hinting={hint.isPending}
              onCheck={() => void runCheck(s)}
              onHint={() => void showHint(s)}
            />
          ))}
        </ol>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {position.prev ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`${base}/${position.prev}`}>
                <ChevronLeft /> Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {position.next && (
            <Button variant={solved ? "default" : "ghost"} size="sm" asChild>
              <Link href={`${base}/${position.next}`}>
                Next exercise <ChevronRight />
              </Link>
            </Button>
          )}
        </div>
      </section>

      {/* ── Terminal ── */}
      <section className="flex min-h-[24rem] flex-1 flex-col gap-3 p-4 sm:p-6">
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            {current && (
              <Button
                onClick={() => void runCheck(current)}
                disabled={!ready || check.isPending}
              >
                {check.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Play />
                )}
                {multi ? `Check step ${current.index + 1}` : "Check"}
              </Button>
            )}
            <Button
              variant={confirmReset ? "destructive" : "ghost"}
              onClick={() => void runReset()}
              disabled={!ready || reset.isPending}
              title="Wipes the exercise folder and prepares it again. Points of solved steps stay."
            >
              {reset.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
              {confirmReset ? "Click again: wipe folder & start over" : "Reset"}
            </Button>
          </div>
        )}

        {!open ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-lg border text-sm">
            This assignment is closed. You can still read the task and your last
            results.
          </div>
        ) : prepError ? (
          <div className="text-destructive flex flex-1 items-center justify-center rounded-lg border p-6 text-center text-sm">
            {prepError}
          </div>
        ) : !ready ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 rounded-lg border text-sm">
            <Loader2 className="size-4 animate-spin" /> Preparing your exercise…
          </div>
        ) : exercise.shell === "PWSH" ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-lg border p-6 text-center text-sm">
            PowerShell exercises aren’t available yet.
          </div>
        ) : (
          <ShellTerminal
            key={termKey}
            shell={exercise.shell}
            exercise={exercise.slug}
            className="min-h-[20rem] flex-1"
          />
        )}
      </section>
    </div>
  );
}

function StepCard({
  step: s,
  multi,
  expanded,
  isCurrent,
  onToggle,
  result,
  canAct,
  allowHints,
  maxChecks,
  checking,
  anyChecking,
  hinting,
  onCheck,
  onHint,
}: {
  step: Step;
  multi: boolean;
  expanded: boolean;
  isCurrent: boolean;
  onToggle: () => void;
  result: CheckResult | null;
  canAct: boolean;
  allowHints: boolean;
  maxChecks: number | null;
  checking: boolean;
  anyChecking: boolean;
  hinting: boolean;
  onCheck: () => void;
  onHint: () => void;
}) {
  const passed = s.status === "PASSED";
  const checksLeft =
    maxChecks === null ? null : Math.max(0, maxChecks - s.checks);
  const outOfChecks = checksLeft === 0 && !passed;
  const hintsLeft = s.hintCount - s.revealedHints.length;

  return (
    <li
      className={cn(
        "rounded-lg border",
        isCurrent && "border-primary/40",
        !s.unlocked && "opacity-60",
      )}
    >
      {multi && (
        <button
          type="button"
          onClick={onToggle}
          disabled={!s.unlocked}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              passed
                ? "bg-primary/15 text-primary"
                : s.unlocked
                  ? "bg-muted"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {passed ? (
              <CheckCircle2 className="size-4" />
            ) : s.unlocked ? (
              s.index + 1
            ) : (
              <Lock className="size-3.5" />
            )}
          </span>
          <span className="flex-1 font-medium">{s.title}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {s.score ?? 0}/{s.points}
          </span>
          {s.unlocked && (
            <ChevronDown
              className={cn(
                "text-muted-foreground size-4 transition-transform",
                expanded && "rotate-180",
              )}
            />
          )}
        </button>
      )}

      {!s.unlocked && multi && (
        <p className="text-muted-foreground px-3 pb-3 text-xs">
          Unlocks when step {s.index} is solved.
        </p>
      )}

      {s.unlocked && (expanded || !multi) && (
        <div className={cn("flex flex-col gap-3 p-3", multi && "border-t")}>
          {s.description && <Markdown>{s.description}</Markdown>}

          {allowHints && s.hintCount > 0 && (
            <div className="flex flex-col gap-2">
              {s.revealedHints.map((h, i) => (
                <div
                  key={i}
                  className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-400">
                    <Lightbulb className="size-3.5" /> Hint {i + 1}
                  </div>
                  <Markdown>{h}</Markdown>
                </div>
              ))}
              {hintsLeft > 0 && canAct && !passed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={onHint}
                  disabled={hinting}
                >
                  <Lightbulb /> Show a hint ({hintsLeft} left)
                </Button>
              )}
            </div>
          )}

          {result && (
            <div
              className={cn(
                "rounded-lg border p-3",
                result.ok
                  ? "border-primary/40 bg-primary/5"
                  : "border-destructive/40 bg-destructive/5",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                {result.ok ? (
                  <CheckCircle2 className="text-primary size-4" />
                ) : (
                  <XCircle className="text-destructive size-4" />
                )}
                {result.ok ? "Passed" : "Not yet"}
              </div>
              {result.output && (
                <pre className="font-mono text-xs whitespace-pre-wrap">
                  {result.output}
                </pre>
              )}
            </div>
          )}

          {canAct && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={passed ? "ghost" : "secondary"}
                onClick={onCheck}
                disabled={anyChecking || outOfChecks}
              >
                {checking ? <Loader2 className="animate-spin" /> : <Play />}
                {passed
                  ? "Check again"
                  : multi
                    ? `Check step ${s.index + 1}`
                    : "Check"}
              </Button>
              {checksLeft !== null && !passed && (
                <span
                  className={cn(
                    "text-xs",
                    outOfChecks ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {outOfChecks
                    ? "No checks left."
                    : `${checksLeft} checks left`}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
