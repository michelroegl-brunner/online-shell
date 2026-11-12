"use client";

import { CheckCircle2, Loader2, Play, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";

import { ShellTerminal } from "~/components/terminal/shell-terminal";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

type Result = {
  label: string;
  kind: "setup" | "check";
  ok: boolean;
  exitCode: number;
  output: string;
};

/**
 * Teacher test run in the teacher's own box: run setup (once for all
 * steps), solve the steps in the terminal like a student, and run each
 * step's check.
 */
export function TestRunPanel({
  exerciseId,
  slug,
  shell,
  steps,
  dirty,
  onSaveFirst,
}: {
  exerciseId: string;
  slug: string;
  shell: "BASH" | "PWSH";
  /** Saved steps, in order. */
  steps: { id: string; title: string }[];
  dirty: boolean;
  /**
   * Present when the teacher may save; saves before running and returns
   * the saved step ids in order (false = not saved).
   */
  onSaveFirst?: () => Promise<string[] | false>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [termKey, setTermKey] = useState(0);
  const [showTerminal, setShowTerminal] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const setup = api.exercise.testSetup.useMutation();
  const check = api.exercise.testCheck.useMutation();
  const busy = setup.isPending || check.isPending;

  const index = Math.min(stepIndex, Math.max(0, steps.length - 1));
  const stepLabel = (i: number) => `Step ${i + 1}: ${steps[i]?.title ?? ""}`;

  /** Saves if needed; returns the current step ids or null if aborted. */
  async function ensureSaved(): Promise<string[] | null> {
    if (!(dirty && onSaveFirst)) return steps.map((s) => s.id);
    const ids = await onSaveFirst();
    return ids === false ? null : ids;
  }

  async function runSetup() {
    if ((await ensureSaved()) === null) return;
    try {
      const r = await setup.mutateAsync({ id: exerciseId });
      setResult({ label: "Setup", kind: "setup", ...r });
      // The folder was recreated: reconnect so the shell starts inside it.
      setShowTerminal(true);
      setTermKey((k) => k + 1);
    } catch (e) {
      setResult({
        label: "Setup",
        kind: "setup",
        ok: false,
        exitCode: -1,
        output: (e as Error).message,
      });
    }
  }

  async function runCheck() {
    const ids = await ensureSaved();
    if (ids === null) return;
    const stepId = ids[index];
    const label = stepLabel(index);
    if (!stepId) return;
    try {
      const r = await check.mutateAsync({ id: exerciseId, stepId });
      setResult({ label, kind: "check", ...r });
    } catch (e) {
      setResult({
        label,
        kind: "check",
        ok: false,
        exitCode: -1,
        output: (e as Error).message,
      });
    }
  }

  const saveLabel = dirty && onSaveFirst ? "Save & " : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test run</CardTitle>
        <CardDescription>
          Runs in <b>your own</b> shell box, in{" "}
          <code className="font-mono">~/exercises/{slug}</code>. Run the setup
          once, solve the steps in the terminal, and check each step.
          {dirty && !onSaveFirst && " (Uses the saved version.)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void runSetup()} disabled={busy}>
            {setup.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RotateCcw />
            )}
            {saveLabel}Reset &amp; run setup
          </Button>

          {steps.length > 1 && (
            <Select
              value={String(index)}
              onValueChange={(v) => setStepIndex(Number(v))}
            >
              <SelectTrigger className="w-64" aria-label="Step to check">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {steps.map((s, i) => (
                  <SelectItem key={s.id} value={String(i)}>
                    {stepLabel(i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="secondary"
            onClick={() => void runCheck()}
            disabled={busy || steps.length === 0}
          >
            {check.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            {saveLabel}
            {steps.length > 1 ? `Check step ${index + 1}` : "Run check"}
          </Button>
          {!showTerminal && (
            <Button variant="ghost" onClick={() => setShowTerminal(true)}>
              Open terminal
            </Button>
          )}
        </div>

        {result && (
          <div
            className={cn(
              "rounded-lg border p-3",
              result.ok
                ? "border-primary/40 bg-primary/5"
                : "border-destructive/40 bg-destructive/5",
            )}
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {result.ok ? (
                <CheckCircle2 className="text-primary size-4" />
              ) : (
                <XCircle className="text-destructive size-4" />
              )}
              {result.label}:{" "}
              {result.kind === "setup"
                ? result.ok
                  ? "finished"
                  : "failed"
                : result.ok
                  ? "check passed"
                  : "check failed"}
              <span className="text-muted-foreground font-normal">
                exit {result.exitCode}
              </span>
            </div>
            <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap">
              {result.output || "(no output)"}
            </pre>
          </div>
        )}

        {showTerminal &&
          (shell === "PWSH" ? (
            <p className="text-muted-foreground text-sm">
              The PowerShell image isn’t built yet, so there’s no terminal for
              PowerShell exercises.
            </p>
          ) : (
            <ShellTerminal
              key={termKey}
              shell={shell}
              exercise={slug}
              className="h-96"
            />
          ))}
      </CardContent>
    </Card>
  );
}
