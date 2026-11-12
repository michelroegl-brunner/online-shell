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
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

type Result = {
  kind: "setup" | "check";
  ok: boolean;
  exitCode: number;
  output: string;
};

/**
 * Teacher test run in the teacher's own box: run setup, solve it in the
 * terminal like a student, then run the check.
 */
export function TestRunPanel({
  exerciseId,
  slug,
  shell,
  dirty,
  onSaveFirst,
}: {
  exerciseId: string;
  slug: string;
  shell: "BASH" | "PWSH";
  dirty: boolean;
  /** Present when the teacher may save; used to save before running. */
  onSaveFirst?: () => Promise<boolean>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [termKey, setTermKey] = useState(0);
  const [showTerminal, setShowTerminal] = useState(false);

  const setup = api.exercise.testSetup.useMutation();
  const check = api.exercise.testCheck.useMutation();
  const busy = setup.isPending || check.isPending;

  async function run(kind: "setup" | "check") {
    if (dirty && onSaveFirst && !(await onSaveFirst())) return;
    try {
      const r =
        kind === "setup"
          ? await setup.mutateAsync({ id: exerciseId })
          : await check.mutateAsync({ id: exerciseId });
      setResult({ kind, ok: r.ok, exitCode: r.exitCode, output: r.output });
      if (kind === "setup") {
        // The folder was recreated: reconnect so the shell starts inside it.
        setShowTerminal(true);
        setTermKey((k) => k + 1);
      }
    } catch (e) {
      setResult({
        kind,
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
          <code className="font-mono">~/exercises/{slug}</code>. Run the setup,
          solve the task in the terminal, then run the check.
          {dirty && !onSaveFirst && " (Uses the saved version.)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run("setup")} disabled={busy}>
            {setup.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RotateCcw />
            )}
            {saveLabel}Reset &amp; run setup
          </Button>
          <Button
            variant="secondary"
            onClick={() => void run("check")}
            disabled={busy}
          >
            {check.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            {saveLabel}Run check
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
              {result.kind === "setup"
                ? result.ok
                  ? "Setup finished"
                  : "Setup failed"
                : result.ok
                  ? "Check passed"
                  : "Check failed"}
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
