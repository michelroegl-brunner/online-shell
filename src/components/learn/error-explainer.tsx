"use client";

import { ChevronRight, Lightbulb, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "~/components/markdown";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type Recent = RouterOutputs["explain"]["recent"];
type Item = Extract<Recent, { enabled: true }>["items"][number];

const DEBOUNCE_MS = 1200;
const storageKey = (itemId: string) => `oshell:explain-dismissed:${itemId}`;

function loadDismissed(itemId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(storageKey(itemId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(list)
        ? list.filter((x): x is string => typeof x === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveDismissed(itemId: string, ids: Set<string>) {
  try {
    // keep the newest few hundred; ids are only meaningful per exercise
    sessionStorage.setItem(
      storageKey(itemId),
      JSON.stringify([...ids].slice(-300)),
    );
  } catch {
    // private mode / storage full: dismissing still works for this page
  }
}

/**
 * "Why did my command fail?" — short explanations for the student's latest
 * failed (or suspicious) commands in this exercise, shown under the
 * terminal. Off in exams and when hints are disabled (the server decides).
 */
export function ErrorExplainer(props: {
  itemId: string;
  /** Bumped by the parent after each command; refetch (debounced ~1.2s) when it changes. */
  trigger: number;
  className?: string;
}) {
  const { itemId, trigger, className } = props;
  const { data, refetch } = api.explain.recent.useQuery(
    { itemId },
    { refetchOnWindowFocus: false, retry: false },
  );

  // Refetch shortly after the latest command (the log is ingested then).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void refetch(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trigger, refetch]);

  const [stored, setStored] = useState(() => ({
    itemId,
    ids: loadDismissed(itemId),
  }));
  const dismissed =
    stored.itemId === itemId ? stored.ids : loadDismissed(itemId);
  const dismiss = useCallback(
    (id: string) => {
      const next = new Set(dismissed);
      next.add(id);
      saveDismissed(itemId, next);
      setStored({ itemId, ids: next });
    },
    [dismissed, itemId],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!data?.enabled) return null;
  const items = data.items.filter((i) => !dismissed.has(i.id));
  if (items.length === 0) return null;
  const [newest, ...older] = items;

  return (
    <section
      aria-label="Command explanations"
      className={cn(
        "min-w-0 rounded-md border border-amber-500/30 bg-amber-500/5 text-sm",
        className,
      )}
    >
      <ExplainEntry item={newest!} open onDismiss={dismiss} />
      {older.length > 0 && (
        <ul className="border-t border-amber-500/20">
          {older.map((item) => (
            <li
              key={item.id}
              className="border-b border-amber-500/10 last:border-b-0"
            >
              <ExplainEntry
                item={item}
                open={expanded.has(item.id)}
                onToggle={() => toggle(item.id)}
                onDismiss={dismiss}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExplainEntry({
  item,
  open,
  onToggle,
  onDismiss,
}: {
  item: Item;
  open: boolean;
  /** Only older entries can be collapsed. */
  onToggle?: () => void;
  onDismiss: (id: string) => void;
}) {
  const e = item.explanation;
  const heading = (
    <>
      {onToggle ? (
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-amber-400 transition-transform",
            open && "rotate-90",
          )}
        />
      ) : (
        <Lightbulb className="size-3.5 shrink-0 text-amber-400" />
      )}
      <span
        className={cn(
          "min-w-0 truncate font-medium",
          onToggle ? "text-muted-foreground text-xs" : "text-amber-400",
        )}
      >
        {e.title}
      </span>
    </>
  );

  return (
    <div className={cn("px-3", onToggle ? "py-1.5" : "py-2.5")}>
      <div className="flex min-w-0 items-center gap-1.5">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {heading}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {heading}
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground shrink-0"
          aria-label="Dismiss explanation"
          title="Dismiss"
          onClick={() => onDismiss(item.id)}
        >
          <X />
        </Button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <div className="bg-muted/60 flex min-w-0 items-start gap-2 rounded px-2 py-1 font-mono text-xs">
            <span className="text-muted-foreground select-none">$</span>
            <code className="min-w-0 flex-1 break-all whitespace-pre-wrap">
              {item.command}
            </code>
            {item.exitCode !== null && item.exitCode !== 0 && (
              <span
                className="text-muted-foreground shrink-0"
                title="Exit code"
              >
                exit {item.exitCode}
              </span>
            )}
          </div>
          <Markdown className="prose-p:my-1 prose-pre:my-1 [overflow-wrap:anywhere]">
            {e.detail}
          </Markdown>
          {e.fix && (
            <div className="flex min-w-0 items-start gap-2 text-xs">
              <span className="shrink-0 font-medium text-emerald-400">Fix</span>
              <code className="bg-muted/60 min-w-0 flex-1 rounded px-2 py-0.5 font-mono break-all whitespace-pre-wrap">
                {e.fix}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
