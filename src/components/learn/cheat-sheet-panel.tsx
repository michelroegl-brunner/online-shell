"use client";

import {
  BookOpen,
  Check,
  Copy,
  CornerDownLeft,
  PanelRightClose,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const useSheets = (itemId: string) =>
  api.cheatsheet.forItem.useQuery(
    { itemId },
    { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false },
  ).data;

/**
 * Toolbar toggle for the cheat sheet panel. Shares the open state with
 * `CheatSheetPanel` (persisted), and renders nothing when no sheet matches.
 */
export function CheatSheetButton({
  itemId,
  className,
}: {
  itemId: string;
  className?: string;
}) {
  const sheets = useSheets(itemId);
  const [openRaw, setOpenRaw] = usePersisted(OPEN_KEY);
  if (!sheets || sheets.length === 0) return null;
  const open = openRaw === "1";
  return (
    <Button
      type="button"
      variant={open ? "secondary" : "ghost"}
      className={className}
      onClick={() => setOpenRaw(open ? "0" : "1")}
      aria-pressed={open}
      title={open ? "Hide the cheat sheet" : "Show the cheat sheet"}
    >
      <BookOpen /> Cheat sheet
      {sheets.length > 1 && (
        <Badge variant="outline" className="px-1.5 text-[10px]">
          {sheets.length}
        </Badge>
      )}
    </Button>
  );
}

/**
 * Topic cheat sheets next to the terminal (exercise workspace). Shows the
 * sheets matching the exercise (same shell, overlapping tags; see
 * `cheatsheet.forItem`) while opened with `CheatSheetButton`, and renders
 * nothing when closed, when none match or the assignment turned them off.
 * The caller sizes it (it fills the height it is given and scrolls).
 */
export function CheatSheetPanel({
  itemId,
  onInsert,
  className,
}: {
  itemId: string;
  /** Type text into the terminal without running it (optional). */
  onInsert?: (text: string) => void;
  className?: string;
}) {
  const sheets = useSheets(itemId);
  const [openRaw, setOpenRaw] = usePersisted(OPEN_KEY);
  const [storedSlug, setStoredSlug] = usePersisted(SHEET_KEY);
  const [q, setQ] = useState("");

  const sheet =
    sheets?.find((s) => s.slug === storedSlug) ?? sheets?.[0] ?? null;
  const sections = useMemo(
    () => (sheet ? splitSections(sheet.body) : []),
    [sheet],
  );
  const query = q.trim().toLowerCase();
  const shown = query
    ? sections.filter((s) => s.text.toLowerCase().includes(query))
    : sections;
  // When nothing matches here, point to other sheets that have a match.
  const elsewhere =
    query && shown.length === 0 && sheets
      ? sheets.filter(
          (s) =>
            s.id !== sheet?.id &&
            splitSections(s.body).some((x) =>
              x.text.toLowerCase().includes(query),
            ),
        )
      : [];

  if (!sheets || sheets.length === 0 || !sheet) return null;
  const open = openRaw === "1";

  if (!open) return null;

  return (
    <section
      aria-label="Cheat sheet"
      className={cn(
        "bg-card text-card-foreground flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <BookOpen className="text-muted-foreground size-4 shrink-0" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {sheets.length === 1 ? sheet.title : "Cheat sheet"}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close cheat sheet"
          title="Close"
          onClick={() => setOpenRaw("0")}
        >
          <PanelRightClose />
        </Button>
      </header>

      <div className="flex flex-col gap-2 border-b px-3 py-2">
        {sheets.length > 1 &&
          (sheets.length <= 4 ? (
            <div
              role="tablist"
              aria-label="Cheat sheets"
              className="bg-muted flex flex-wrap gap-0.5 rounded-md p-0.5"
            >
              {sheets.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={s.id === sheet.id}
                  onClick={() => setStoredSlug(s.slug)}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded px-2 py-1 text-xs",
                    s.id === sheet.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.title}
                </button>
              ))}
            </div>
          ) : (
            <Select value={sheet.slug} onValueChange={setStoredSlug}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((s) => (
                  <SelectItem key={s.id} value={s.slug}>
                    {s.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-2 left-2 size-4" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sections…"
            aria-label="Search cheat sheet sections"
            className="h-8 pr-8 pl-8 text-sm"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQ("")}
              className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 rounded p-0.5"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {shown.length > 0 ? (
          <SheetMarkdown onInsert={onInsert}>
            {shown.map((s) => s.markdown).join("\n\n")}
          </SheetMarkdown>
        ) : (
          <div className="text-muted-foreground py-6 text-center text-sm">
            <p>No section matches “{q.trim()}”.</p>
            {elsewhere.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center justify-center gap-1">
                Found in:
                {elsewhere.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setStoredSlug(s.slug)}
                  >
                    {s.title}
                  </Button>
                ))}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- storage

const OPEN_KEY = "oshell.cheatsheet.open";
const SHEET_KEY = "oshell.cheatsheet.sheet";

/**
 * Tiny localStorage-backed store. Values written in this tab live in memory
 * too, so the panel still works when storage is blocked (private mode).
 * The server snapshot is null, so hydration never mismatches.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readStored(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full: the in-memory value is enough.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function usePersisted(key: string): [string | null, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
  const set = useCallback((v: string) => writeStored(key, v), [key]);
  return [value, set];
}

// --------------------------------------------------------------- sections

type Section = { markdown: string; text: string };

/**
 * Split Markdown at headings (outside code fences). Text before the first
 * heading is its own section. `text` is what the search looks at (the
 * heading and its content).
 */
function splitSections(md: string): Section[] {
  const out: string[][] = [[]];
  let fence: string | null = null;
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]!.charAt(0);
      else if (f[1]!.startsWith(fence)) fence = null;
    }
    if (!fence && !f && /^#{1,6}\s/.test(line)) out.push([]);
    out[out.length - 1]!.push(line);
  }
  return out
    .map((lines) => lines.join("\n").trim())
    .filter(Boolean)
    .map((markdown) => ({ markdown, text: markdown }));
}

// --------------------------------------------------------------- markdown

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

const hastText = (n: HastNode | undefined): string =>
  !n
    ? ""
    : n.type === "text"
      ? (n.value ?? "")
      : (n.children ?? []).map(hastText).join("");

/**
 * A line worth typing into the terminal: not blank, not only a comment.
 * Trailing comments separated by 2+ spaces are dropped.
 */
function insertable(line: string): string | null {
  const t = line.replace(/\s{2,}#\s.*$/, "").trim();
  if (!t || t.startsWith("#")) return null;
  return t;
}

function CodeBlock({
  node,
  onInsert,
}: {
  node?: HastNode;
  onInsert?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const code = node?.children?.find((c) => c.tagName === "code");
  const text = hastText(code ?? node).replace(/\n$/, "");
  const lines = text.split("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard not available (insecure context / denied).
    }
  }

  return (
    <div className="group/code relative">
      <pre className="pr-9">
        <code>
          {lines.map((line, i) => {
            const cmd = onInsert ? insertable(line) : null;
            return (
              <span key={i} className="group/line relative block min-h-[1lh]">
                {line}
                {cmd && (
                  <button
                    type="button"
                    title={`Insert into terminal: ${cmd}`}
                    aria-label={`Insert into terminal: ${cmd}`}
                    onClick={() => onInsert!(cmd)}
                    className="bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground ml-2 inline-flex translate-y-0.5 items-center rounded px-1 align-baseline opacity-0 transition-opacity group-hover/line:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-70"
                  >
                    <CornerDownLeft className="size-3" />
                  </button>
                )}
              </span>
            );
          })}
        </code>
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code"
        title="Copy"
        className="text-muted-foreground hover:text-foreground bg-background/60 absolute top-1.5 right-1.5 rounded p-1 opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}

function SheetMarkdown({
  children,
  onInsert,
}: {
  children: string;
  onInsert?: (text: string) => void;
}) {
  const components = useMemo<Components>(
    () => ({
      pre: ({ node }) => <CodeBlock node={node} onInsert={onInsert} />,
      table: ({ children }: { children?: ReactNode }) => (
        <div className="my-3 overflow-x-auto">
          <table className="my-0">{children}</table>
        </div>
      ),
    }),
    [onInsert],
  );
  return (
    <div className="prose prose-invert prose-sm prose-pre:bg-black/60 prose-pre:my-2 prose-pre:px-3 prose-pre:py-2 prose-pre:text-xs prose-code:before:content-none prose-code:after:content-none prose-headings:mt-4 prose-headings:mb-2 prose-h2:text-base prose-h3:text-sm prose-table:text-xs prose-th:px-2 prose-td:px-2 prose-td:py-1 max-w-none break-words [&_td_code]:break-normal [&_td_code]:whitespace-nowrap">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
