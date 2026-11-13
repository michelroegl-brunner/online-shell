"use client";

import "@xterm/xterm/css/xterm.css";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { Eye, Hand, Keyboard, Loader2, RotateCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { TERMINAL_LINE_HEIGHT, terminalFontFamily } from "./font";

type Status = "connecting" | "ready" | "closed" | "error";

/** Imperative access for the page (via the `ref` prop). */
export type ShellTerminalHandle = {
  /**
   * Put text at the prompt WITHOUT running it (no Enter is added), e.g. a
   * lesson's example. "blocked": pasting is off for the student (the usual
   * notice was shown); "offline": the shell isn't connected.
   */
  sendText: (text: string) => "sent" | "blocked" | "offline";
};

/**
 * Browser terminal attached to the student's box via the runner WebSocket.
 * Binary frames carry terminal bytes; text frames carry JSON control.
 */
export function ShellTerminal({
  shell = "BASH",
  exercise,
  itemId,
  testInternet,
  className,
  onCommand,
  ref,
}: {
  shell?: "BASH" | "PWSH";
  /** Exercise slug: start the shell in ~/exercises/<slug>. */
  exercise?: string;
  /**
   * Assignment item this terminal works on: the server turns the box's
   * internet on while the current step allows it.
   */
  itemId?: string;
  /** Teacher test run of an exercise with internet steps. */
  testInternet?: boolean;
  className?: string;
  /**
   * Called when the student presses Enter (a command was probably run).
   * Not debounced; the command itself isn't known here (see the command log).
   */
  onCommand?: () => void;
  ref?: Ref<ShellTerminalHandle>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [session, setSession] = useState(0); // bump to reconnect
  // Set from the attach call (decided by the server, also enforced by the
  // runner); read by the paste/drop handlers registered once below.
  const pasteBlockedRef = useRef(false);
  const lastNoticeRef = useRef(0);
  const [pasteBlocked, setPasteBlocked] = useState(false);
  /** Teachers watching this student's terminal (read-only). */
  const [watchers, setWatchers] = useState(0);
  /** A teacher asks to type in this terminal (name), or is typing. */
  const [controlRequest, setControlRequest] = useState<string | null>(null);
  const [controlledBy, setControlledBy] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  // Latest callback without re-running the connect effect.
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  const notifyPasteBlocked = useCallback(() => {
    const now = Date.now();
    if (now - lastNoticeRef.current < 3000) return;
    lastNoticeRef.current = now;
    toast.info(
      "Pasting is turned off for your current assignment — please type it.",
    );
  }, []);

  // Tell the runner about a paste the browser blocked, so the teacher sees
  // it (the runner batches and stores these; nothing is sent to the shell).
  const reportPasteAttempt = useCallback(
    (reason: "paste" | "drop" | "shortcut", bytes = 0) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "paste-attempt", reason, bytes }));
      }
    },
    [],
  );

  // Plain client call (stable reference) instead of useMutation state.
  const trpc = api.useUtils().client;

  // Create the xterm instance once.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => undefined as void;
    void (async () => {
      const [{ Terminal }, { FitAddon }, fontFamily] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        terminalFontFamily(14),
      ]);
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        cursorBlink: true,
        fontFamily,
        fontSize: 14,
        lineHeight: TERMINAL_LINE_HEIGHT,
        theme: { background: "#0a0a0a" },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      const onResize = () => fit.fit();
      const ro = new ResizeObserver(onResize);
      const host = hostRef.current;
      ro.observe(host);

      // Paste blocking: capture-phase listeners on the host run before
      // xterm's own handlers on its hidden textarea.
      const block = (e: Event) => {
        if (!pasteBlockedRef.current) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type === "dragover") return;
        notifyPasteBlocked();
        if (e instanceof ClipboardEvent) {
          reportPasteAttempt(
            "paste",
            e.clipboardData?.getData("text/plain").length ?? 0,
          );
        } else if (e instanceof DragEvent) {
          const dt = e.dataTransfer;
          const files = [...(dt?.files ?? [])].reduce((n, f) => n + f.size, 0);
          reportPasteAttempt(
            "drop",
            (dt?.getData("text/plain").length ?? 0) + files,
          );
        }
      };
      for (const t of ["paste", "drop", "dragover"]) {
        host.addEventListener(t, block, true);
      }
      term.attachCustomKeyEventHandler((e) => {
        if (!pasteBlockedRef.current || e.type !== "keydown") return true;
        const isPasteKey =
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") ||
          (e.shiftKey && e.key === "Insert");
        if (isPasteKey) {
          e.preventDefault();
          notifyPasteBlocked();
          reportPasteAttempt("shortcut");
          return false;
        }
        return true;
      });

      cleanup = () => {
        ro.disconnect();
        for (const t of ["paste", "drop", "dragover"]) {
          host.removeEventListener(t, block, true);
        }
        term.dispose();
      };
      setSession((s) => s + 1); // first connect once the terminal exists
    })();
    return () => {
      disposed = true;
      cleanup();
    };
    // Both callbacks are stable (useCallback with no deps).
  }, [notifyPasteBlocked, reportPasteAttempt]);

  // (Re)connect whenever `session` changes.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || session === 0) return;

    let ws: WebSocket | null = null;
    let closedByUs = false;
    const disposables: { dispose(): void }[] = [];
    setStatus("connecting");
    setErrorText(null);

    void (async () => {
      try {
        const { url, token, allowPaste } = await trpc.box.attach.mutate({
          shell,
          exercise,
          itemId,
          testInternet,
        });
        if (closedByUs) return;
        pasteBlockedRef.current = !allowPaste;
        setPasteBlocked(!allowPaste);
        const qs = new URLSearchParams({
          token,
          cols: String(term.cols),
          rows: String(term.rows),
        });
        ws = new WebSocket(`${url}?${qs}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        const enc = new TextEncoder();

        ws.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(ev.data));
            return;
          }
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            allowed?: boolean;
            count?: number;
            by?: string | null;
            active?: boolean;
          };
          if (msg.type === "ready") {
            setStatus("ready");
            term.focus();
          } else if (msg.type === "watched") {
            setWatchers(msg.count ?? 0);
          } else if (msg.type === "control-request") {
            setControlRequest(msg.by ?? null);
          } else if (msg.type === "control") {
            setControlRequest(null);
            setControlledBy(msg.active ? (msg.by ?? "Your teacher") : null);
          } else if (msg.type === "paste-blocked") {
            notifyPasteBlocked();
          } else if (msg.type === "paste-policy" && msg.allowed === false) {
            // A no-paste assignment just opened.
            pasteBlockedRef.current = true;
            setPasteBlocked(true);
          }
        };
        ws.onclose = () => {
          if (!closedByUs) setStatus("closed");
          setControlRequest(null);
          setControlledBy(null);
        };
        ws.onerror = () => setStatus("error");

        disposables.push(
          term.onData((d) => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(enc.encode(d));
            if (d.includes("\r")) onCommandRef.current?.();
          }),
          term.onResize(({ cols, rows }) => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "resize", cols, rows }));
            }
          }),
        );
      } catch (e) {
        // e.g. an exam is running and this terminal isn't part of it.
        setErrorText(e instanceof Error ? e.message : null);
        setStatus("error");
      }
    })();

    return () => {
      closedByUs = true;
      disposables.forEach((d) => d.dispose());
      ws?.close();
    };
  }, [
    session,
    shell,
    exercise,
    itemId,
    testInternet,
    trpc,
    notifyPasteBlocked,
  ]);

  const sendControl = (msg: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  useImperativeHandle(
    ref,
    () => ({
      sendText: (text) => {
        const term = termRef.current;
        const ws = wsRef.current;
        if (!term || ws?.readyState !== WebSocket.OPEN) return "offline";
        // Inserting text is pasting: same rule as Ctrl+V (the runner would
        // drop it anyway).
        if (pasteBlockedRef.current) {
          notifyPasteBlocked();
          return "blocked";
        }
        // xterm's paste() uses bracketed paste when the shell enabled it
        // (bash does), so multi-line code is inserted, not run. Trailing
        // newlines are dropped: the student presses Enter themselves.
        term.paste(text.replace(/\s+$/, ""));
        term.focus();
        return "sent";
      },
    }),
    [notifyPasteBlocked],
  );

  const reconnect = useCallback(() => {
    termRef.current?.reset();
    setSession((s) => s + 1);
  }, []);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-[#0a0a0a] p-2",
        className,
      )}
    >
      <div ref={hostRef} className="h-full w-full" />
      {pasteBlocked && status === "ready" && (
        <span
          className="text-muted-foreground pointer-events-none absolute top-2 right-3 rounded border border-white/10 bg-black/70 px-1.5 py-0.5 text-[11px]"
          title="Your teacher turned off pasting for the current assignment."
        >
          Pasting disabled
        </span>
      )}
      {status === "ready" && controlRequest && (
        <div className="absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-sky-400/40 bg-black/90 px-3 py-2 text-sm">
          <Hand className="size-4 text-sky-300" />
          <span className="flex-1">
            <strong>{controlRequest}</strong> wants to type in your terminal.
          </span>
          <Button
            size="sm"
            onClick={() =>
              sendControl({ type: "control-response", allow: true })
            }
          >
            Allow
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              sendControl({ type: "control-response", allow: false });
              setControlRequest(null);
            }}
          >
            Deny
          </Button>
        </div>
      )}
      {status === "ready" && controlledBy && (
        <div className="absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-sky-400/40 bg-sky-950/90 px-3 py-2 text-sm">
          <Keyboard className="size-4 text-sky-300" />
          <span className="flex-1">
            <strong>{controlledBy}</strong> is typing in your terminal.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => sendControl({ type: "control-revoke" })}
          >
            Take back control
          </Button>
        </div>
      )}
      {watchers > 0 && status === "ready" && (
        <span
          className="pointer-events-none absolute top-2 right-3 flex items-center gap-1 rounded border border-sky-400/30 bg-black/80 px-1.5 py-0.5 text-[11px] text-sky-300"
          style={pasteBlocked ? { top: "1.9rem" } : undefined}
          title="Your teacher can see this terminal. They can only type in it if you allow it."
        >
          <Eye className="size-3" /> Teacher is watching
        </span>
      )}
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          {status === "connecting" ? (
            <span className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Starting your shell…
            </span>
          ) : (
            <div className="flex flex-col items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {status === "error"
                  ? (errorText ?? "Could not connect to the shell.")
                  : "Session ended."}
              </span>
              <Button size="sm" variant="secondary" onClick={reconnect}>
                <RotateCw /> Reconnect
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
