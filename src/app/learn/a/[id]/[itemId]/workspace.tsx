"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Loader2,
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
type CheckResult = { ok: boolean; output: string };

export function Workspace({ initial }: { initial: Item }) {
  const utils = api.useUtils();
  const { data } = api.learn.item.useQuery(
    { itemId: initial.itemId },
    { initialData: initial, refetchOnWindowFocus: false },
  );
  const item = data ?? initial;
  const { assignment, exercise, attempt, position } = item;
  const open = assignment.state === "open";

  const [ready, setReady] = useState(Boolean(attempt?.prepared));
  const [prepError, setPrepError] = useState<string | null>(null);
  const [termKey, setTermKey] = useState(0);
  const [result, setResult] = useState<CheckResult | null>(
    attempt?.lastCheckOutput != null
      ? { ok: attempt.status === "PASSED", output: attempt.lastCheckOutput }
      : null,
  );
  const [confirmReset, setConfirmReset] = useState(false);

  const start = api.learn.start.useMutation();
  const check = api.learn.check.useMutation();
  const hint = api.learn.hint.useMutation();
  const reset = api.learn.reset.useMutation();

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

  async function runCheck() {
    try {
      const r = await check.mutateAsync({ itemId: item.itemId });
      setResult({ ok: r.ok, output: r.output });
      if (r.ok) toast.success("Solved! 🎉");
      await Promise.all([
        utils.learn.item.invalidate({ itemId: item.itemId }),
        utils.learn.assignment.invalidate(),
        utils.learn.overview.invalidate(),
      ]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function showHint() {
    try {
      await hint.mutateAsync({ itemId: item.itemId });
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
      toast.success("Exercise reset");
      setResult(null);
      setTermKey((k) => k + 1); // the folder was recreated: new shell in it
      await utils.learn.item.invalidate({ itemId: item.itemId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const solved = attempt?.status === "PASSED";
  const checks = attempt?.checks ?? 0;
  const checksLeft =
    assignment.maxChecks === null
      ? null
      : Math.max(0, assignment.maxChecks - checks);
  const outOfChecks = checksLeft === 0 && !solved;
  const revealed = attempt?.revealedHints ?? [];
  const hintsLeft = exercise.hintCount - revealed.length;
  const base = `/learn/a/${assignment.id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* ── Task ── */}
      <section className="flex flex-col gap-4 overflow-y-auto border-b p-4 sm:p-6 lg:w-[42%] lg:border-r lg:border-b-0">
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
            {checksLeft !== null && <span>· {checksLeft} checks left</span>}
            <WindowBadge state={assignment.state} dueAt={assignment.dueAt} />
          </div>
        </div>

        <Markdown>{exercise.description}</Markdown>

        <p className="text-muted-foreground text-xs">
          Your files are in{" "}
          <code className="font-mono">~/exercises/{exercise.slug}</code>.
        </p>

        {assignment.allowHints && exercise.hintCount > 0 && (
          <div className="flex flex-col gap-2">
            {revealed.map((h, i) => (
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
            {hintsLeft > 0 && open && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => void showHint()}
                disabled={hint.isPending || !ready}
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
            <Button
              onClick={() => void runCheck()}
              disabled={!ready || check.isPending || outOfChecks}
            >
              {check.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}
              Check
            </Button>
            <Button
              variant={confirmReset ? "destructive" : "ghost"}
              onClick={() => void runReset()}
              disabled={!ready || reset.isPending}
            >
              {reset.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RotateCcw />
              )}
              {confirmReset ? "Click again: wipe folder & start over" : "Reset"}
            </Button>
            {outOfChecks && (
              <span className="text-destructive text-sm">No checks left.</span>
            )}
          </div>
        )}

        {!open ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-lg border text-sm">
            This assignment is closed. You can still read the task and your last
            result.
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
