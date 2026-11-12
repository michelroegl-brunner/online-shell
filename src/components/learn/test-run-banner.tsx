"use client";

import { FlaskConical, Loader2, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

/**
 * Shown when a teacher goes through an assignment ("test run"): no time
 * window, drafts allowed, attempts not counted in reports.
 */
export function TestRunBanner({
  assignmentId,
  published,
  className,
}: {
  assignmentId: string;
  published?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [confirm, setConfirm] = useState(false);
  const reset = api.learn.resetPreview.useMutation();

  async function startOver() {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setConfirm(false);
    try {
      const r = await reset.mutateAsync({ assignmentId });
      await utils.learn.invalidate();
      toast.success(
        r.deleted
          ? "Test run reset — exercises start fresh"
          : "Nothing to reset",
      );
      router.push(`/learn/a/${assignmentId}`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm",
        className,
      )}
    >
      <FlaskConical className="size-4 shrink-0 text-sky-400" />
      <span className="mr-auto">
        <b>Test run</b> — you see this like a student. Your attempts are not
        counted{published === false ? "; the assignment is still a draft" : ""}.
      </span>
      <Button
        size="sm"
        variant={confirm ? "destructive" : "ghost"}
        onClick={() => void startOver()}
        disabled={reset.isPending}
      >
        {reset.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        {confirm ? "Click again to start over" : "Start over"}
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link href={`/admin/assignments/${assignmentId}`}>
          <Pencil /> Edit assignment
        </Link>
      </Button>
    </div>
  );
}
