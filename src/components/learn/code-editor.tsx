"use client";

import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { StreamLanguage } from "@codemirror/language";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { FilePlus, Loader2, Play, RefreshCw, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { type ShellKind } from "~/lib/shell";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

/**
 * Code editor next to the terminal: edits the files in ~/exercises/<slug>
 * (saved into the student's box, so the terminal sees them) — .c / .h /
 * Makefile for C, .sh scripts for bash, .ps1 scripts for PowerShell. Saves
 * by itself after a short pause and before Run; Run types `crun` (C:
 * compile + run) or runs the open script in the terminal.
 *
 * The files stay the truth: editing them in vim/nano works too — "Reload"
 * picks up those changes.
 */

const AUTOSAVE_MS = 800;

type Doc = {
  state: EditorState;
  /** Text as last saved / loaded. */
  saved: string;
  /** Cut off when loading (too big): read only, never saved. */
  truncated: boolean;
  /** dataUpdatedAt of the read it came from (Reload → newer). */
  loadedAt: number;
};

type Hooks = {
  isPasteBlocked: () => boolean;
  onPasteBlocked: (reason: "paste" | "drop", bytes: number) => void;
  onRun: () => void;
  onDirty: (path: string, dirty: boolean) => void;
  save: (path: string, text: string) => Promise<void>;
};

const shellLang = StreamLanguage.define(shell);
const pwshLang = StreamLanguage.define(powerShell);

/** Syntax highlighting by file name (Makefile: none). */
function languageFor(path: string) {
  if (/\.[ch]$/.test(path)) return [cpp()];
  if (path.endsWith(".sh")) return [shellLang];
  if (path.endsWith(".ps1")) return [pwshLang];
  return [];
}

/** Texts and defaults that differ between C and script exercises. */
const KIND_TEXT: Record<
  ShellKind,
  { newPrompt: string; empty: string; starter: string; runTitle: string }
> = {
  C: {
    newPrompt: "New file (e.g. list.c, list.h or Makefile):",
    empty: "No C files in this exercise yet.",
    starter: "main.c",
    runTitle: "Save, compile and run in the terminal (Ctrl+Enter)",
  },
  BASH: {
    newPrompt: "New script (e.g. script.sh):",
    empty: "No scripts (.sh) in this exercise folder yet.",
    starter: "",
    runTitle:
      "Save and run this script in the terminal (Ctrl+Enter). Arrow-up there to add arguments.",
  },
  PWSH: {
    newPrompt: "New script (e.g. script.ps1):",
    empty: "No scripts (.ps1) in this exercise folder yet.",
    starter: "",
    runTitle:
      "Save and run this script in the terminal (Ctrl+Enter). Arrow-up there to add arguments.",
  },
};

/**
 * The CodeMirror view and the open files, outside React: one view, and
 * switching files swaps its state (keeps undo per file).
 */
class EditorSession {
  private view: EditorView | null = null;
  private docs = new Map<string, Doc>();
  private current: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<boolean> | null = null;
  private hooks: Hooks = {
    isPasteBlocked: () => false,
    onPasteBlocked: () => undefined,
    onRun: () => undefined,
    onDirty: () => undefined,
    save: async () => undefined,
  };

  setHooks(hooks: Hooks) {
    this.hooks = hooks;
  }

  mount(host: HTMLElement) {
    this.view = new EditorView({ parent: host });
    const d = this.current ? this.docs.get(this.current) : undefined;
    if (d) this.view.setState(d.state);
  }

  unmount() {
    this.keepCurrent();
    if (this.timer) void this.saveAll();
    this.view?.destroy();
    this.view = null;
  }

  loadedAt(path: string) {
    return this.docs.get(path)?.loadedAt ?? -1;
  }

  load(
    path: string,
    f: { text: string; truncated: boolean },
    readOnly: boolean,
    loadedAt: number,
  ) {
    this.docs.set(path, {
      state: this.makeState(f.text, readOnly || f.truncated, path),
      saved: f.text,
      truncated: f.truncated,
      loadedAt,
    });
    this.hooks.onDirty(path, false);
  }

  show(path: string) {
    const d = this.docs.get(path);
    if (!d || !this.view) return;
    if (this.current !== path) this.keepCurrent();
    this.current = path;
    if (this.view.state !== d.state) this.view.setState(d.state);
  }

  /** Save every changed file; waits for a save that is running. */
  async saveAll(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) await this.saving;
    this.saving = this.doSave();
    try {
      return await this.saving;
    } finally {
      this.saving = null;
    }
  }

  private async doSave() {
    this.keepCurrent();
    let ok = true;
    for (const [path, d] of this.docs) {
      const text = d.state.doc.toString();
      if (d.truncated || text === d.saved) continue;
      try {
        await this.hooks.save(path, text);
        d.saved = text;
        // Typed meanwhile? Then it stays dirty.
        this.keepCurrent();
        this.hooks.onDirty(path, d.state.doc.toString() !== text);
      } catch (e) {
        ok = false;
        toast.error(`${path}: ${(e as Error).message}`);
      }
    }
    return ok;
  }

  private keepCurrent() {
    const d = this.current ? this.docs.get(this.current) : undefined;
    if (d && this.view) d.state = this.view.state;
  }

  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveAll();
    }, AUTOSAVE_MS);
  }

  private makeState(text: string, readOnly: boolean, path: string) {
    return EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        keymap.of([
          indentWithTab,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void this.saveAll();
              return true;
            },
          },
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              this.hooks.onRun();
              return true;
            },
          },
        ]),
        ...languageFor(path),
        oneDark,
        EditorState.tabSize.of(4),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme({
          "&": { height: "100%", fontSize: "14px" },
          ".cm-scroller": { fontFamily: "var(--font-mono, monospace)" },
        }),
        // No-paste assignments: the editor is no way around it.
        EditorView.domEventHandlers({
          paste: (e) => {
            if (!this.hooks.isPasteBlocked()) return false;
            const text = e.clipboardData?.getData("text") ?? "";
            if (!text) return false;
            e.preventDefault();
            this.hooks.onPasteBlocked("paste", text.length);
            return true;
          },
          drop: (e) => {
            if (!this.hooks.isPasteBlocked()) return false;
            e.preventDefault();
            this.hooks.onPasteBlocked(
              "drop",
              e.dataTransfer?.getData("text").length ?? 0,
            );
            return true;
          },
        }),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const d = this.docs.get(path);
          if (!d) return;
          d.state = u.state;
          this.hooks.onDirty(path, u.state.doc.toString() !== d.saved);
          if (!d.truncated) this.scheduleSave();
        }),
      ],
    });
  }
}

export type CodeEditorProps = {
  itemId: string;
  /** Exercise shell: which files it edits (C sources or scripts). */
  shell: ShellKind;
  /** Saving is allowed (assignment open, exercise prepared). */
  editable: boolean;
  /** Run (after saving) with the open file: `crun` / run the script. */
  onRun?: (path: string) => void;
  /** No-paste assignment: block paste / drop into the editor. */
  isPasteBlocked: () => boolean;
  onPasteBlocked: (reason: "paste" | "drop", bytes: number) => void;
  className?: string;
};

export function CodeEditor({
  itemId,
  shell: kind,
  editable,
  onRun,
  isPasteBlocked,
  onPasteBlocked,
  className,
}: CodeEditorProps) {
  const utils = api.useUtils();
  const files = api.learn.sourceFiles.useQuery(
    { itemId },
    { refetchOnWindowFocus: false },
  );
  const save = api.learn.saveSource.useMutation();
  const [session] = useState(() => new EditorSession());
  const hostRef = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const text = KIND_TEXT[kind];

  const list = files.data ?? [];
  // main.c (or the first file) until the student picks one.
  const current = chosen ?? list[0]?.path ?? null;

  const src = api.learn.readSource.useQuery(
    { itemId, path: current ?? "" },
    {
      enabled: current !== null,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  async function run() {
    if (current && (await session.saveAll())) onRun?.(current);
  }

  // Latest callbacks for the editor (it lives outside React).
  useEffect(() => {
    session.setHooks({
      isPasteBlocked,
      onPasteBlocked,
      onRun: () => void run(),
      onDirty: (path, d) =>
        setDirty((m) => (m[path] === d ? m : { ...m, [path]: d })),
      save: async (path, text) => {
        if (!editable) return;
        await save.mutateAsync({ itemId, path, text });
      },
    });
  });

  useEffect(() => {
    if (!hostRef.current) return;
    session.mount(hostRef.current);
    return () => session.unmount();
  }, [session]);

  // Show the current file once it's read (again, after Reload).
  useEffect(() => {
    if (!current) return;
    const d = src.data;
    if (d?.path === current && src.dataUpdatedAt > session.loadedAt(current)) {
      session.load(current, d, !editable, src.dataUpdatedAt);
      if (d.truncated) {
        toast.info(
          `${current} is too big for the editor — it opens read-only. Edit it in the terminal.`,
        );
      }
    }
    session.show(current);
  }, [current, src.data, src.dataUpdatedAt, editable, session]);

  useEffect(() => {
    if (src.error) toast.error(src.error.message);
  }, [src.error]);

  async function newFile(preset?: string) {
    const name = preset ?? window.prompt(text.newPrompt, "");
    if (!name) return;
    const path = name.trim();
    if (!list.some((f) => f.path === path)) {
      try {
        await save.mutateAsync({ itemId, path, text: "" });
        await utils.learn.sourceFiles.invalidate({ itemId });
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    }
    setChosen(path);
  }

  async function reload() {
    if (current && dirty[current]) {
      if (!window.confirm(`Discard your unsaved changes in ${current}?`)) {
        return;
      }
    }
    await utils.learn.sourceFiles.invalidate({ itemId });
    if (current) {
      await utils.learn.readSource.invalidate({ itemId, path: current });
    }
  }

  const anyDirty = Object.values(dirty).some(Boolean);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border bg-[#282c34]",
        className,
      )}
    >
      <div className="flex items-center gap-1 border-b border-white/10 bg-[#21252b] px-1.5 py-1">
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {list.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setChosen(f.path)}
              className={cn(
                "shrink-0 rounded px-2.5 py-1 font-mono text-xs text-neutral-400 hover:text-neutral-100",
                f.path === current && "bg-[#282c34] text-neutral-100",
              )}
            >
              {f.path}
              {dirty[f.path] && <span className="text-amber-400"> ●</span>}
            </button>
          ))}
          {files.isLoading && (
            <Loader2 className="m-1 size-4 animate-spin text-neutral-400" />
          )}
        </div>
        {editable && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-neutral-400"
            title="New file"
            aria-label="New file"
            onClick={() => void newFile()}
          >
            <FilePlus />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-neutral-400"
          title="Reload from disk (after editing in the terminal)"
          aria-label="Reload from disk"
          onClick={() => void reload()}
        >
          <RefreshCw />
        </Button>
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-neutral-300"
            title="Save (Ctrl+S) — also saves by itself"
            onClick={() => void session.saveAll()}
            disabled={save.isPending}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {save.isPending ? "Saving" : anyDirty ? "Save" : "Saved"}
          </Button>
        )}
        {editable && onRun && (
          <Button
            size="sm"
            className="h-7"
            title={text.runTitle}
            onClick={() => void run()}
            disabled={!current}
          >
            <Play /> Run
          </Button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className={cn("absolute inset-0", !current && "invisible")}
        />
        {!current && !files.isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-neutral-400">
            {files.error ? (
              files.error.message
            ) : (
              <>
                {text.empty}
                {editable && (
                  <Button
                    size="sm"
                    onClick={() => void newFile(text.starter || undefined)}
                  >
                    <FilePlus />{" "}
                    {text.starter ? `Create ${text.starter}` : "New script"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        {src.isFetching && (
          <Loader2 className="absolute top-2 right-2 size-4 animate-spin text-neutral-400" />
        )}
      </div>
    </div>
  );
}
