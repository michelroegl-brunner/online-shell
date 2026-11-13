"use client";

import { Megaphone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Teacher messages for an assignment. Polls; new messages pop up as a
 * toast, the newest stays as a banner until dismissed.
 */
export function Announcements({
  assignmentId,
  className,
}: {
  assignmentId: string;
  className?: string;
}) {
  const { data } = api.learn.announcements.useQuery(
    { assignmentId },
    { refetchInterval: 20_000, refetchOnWindowFocus: true },
  );
  const seen = useRef<Set<string> | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    if (!data) return;
    if (seen.current === null) {
      // First load: don't toast old messages.
      seen.current = new Set(data.map((n) => n.id));
      return;
    }
    for (const n of [...data].reverse()) {
      if (!seen.current.has(n.id)) {
        seen.current.add(n.id);
        toast(`${n.author}: ${n.text}`, {
          icon: <Megaphone />,
          duration: 15_000,
        });
      }
    }
  }, [data]);

  const visible = (data ?? []).filter((n) => !dismissed.includes(n.id));
  if (visible.length === 0) return null;
  const [latest, ...older] = visible;

  return (
    <div
      className={cn(
        "border-primary/40 bg-primary/10 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm",
        className,
      )}
      role="status"
    >
      <Megaphone className="text-primary mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-wrap">{latest!.text}</div>
        <div className="text-muted-foreground text-xs">
          {latest!.author} · {timeFmt.format(new Date(latest!.createdAt))}
          {older.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer">
                {older.length} earlier message{older.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {older.map((n) => (
                  <li key={n.id} className="text-foreground/80">
                    <span className="text-muted-foreground">
                      {timeFmt.format(new Date(n.createdAt))}
                    </span>{" "}
                    {n.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setDismissed((d) => [...d, latest!.id])}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
