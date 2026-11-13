"use client";

import "@xterm/xterm/css/xterm.css";

import type { Terminal } from "@xterm/xterm";
import { Eye, Hand, Keyboard, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { TERMINAL_LINE_HEIGHT, terminalFontFamily } from "./font";

type Status = "connecting" | "live" | "waiting" | "closed" | "error";
type Control = "none" | "pending" | "granted" | "denied" | "busy";

/**
 * A student's terminal for the teacher (runner `/watch`). Read-only by
 * default; "Take over" asks the student, and only if they allow it are
 * keystrokes typed here sent to their shell. The terminal keeps the
 * student's size. The student always sees that they are watched.
 */
export function WatchTerminal({
  userId,
  className,
}: {
  userId: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [control, setControl] = useState<Control>("none");
  const [cwd, setCwd] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const trpc = api.useUtils().client;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => undefined as void;
    void (async () => {
      const [{ Terminal }, fontFamily] = await Promise.all([
        import("@xterm/xterm"),
        terminalFontFamily(13),
      ]);
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontFamily,
        fontSize: 13,
        lineHeight: TERMINAL_LINE_HEIGHT,
        theme: { background: "#0a0a0a" },
        scrollback: 5000,
      });
      term.open(hostRef.current);
      termRef.current = term;
      // Only sent while the student has handed over control (the runner
      // drops it otherwise).
      const typing = term.onData((d) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(d));
        }
      });
      cleanup = () => {
        typing.dispose();
        term.dispose();
      };
      setSession((s) => s + 1);
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term || session === 0) return;
    let ws: WebSocket | null = null;
    let closedByUs = false;
    setStatus("connecting");
    setControl("none");
    void (async () => {
      try {
        const { url, token } = await trpc.manage.watch.mutate({ userId });
        if (closedByUs) return;
        ws = new WebSocket(`${url}?${new URLSearchParams({ token })}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(ev.data));
            return;
          }
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            cols?: number;
            rows?: number;
            cwd?: string;
            state?: Control;
          };
          if (msg.type === "session") {
            term.reset();
            if (msg.cols && msg.rows) term.resize(msg.cols, msg.rows);
            setCwd(msg.cwd ?? null);
            setStatus("live");
          } else if (msg.type === "size" && msg.cols && msg.rows) {
            term.resize(msg.cols, msg.rows);
          } else if (msg.type === "waiting") {
            setStatus("waiting");
            setCwd(null);
          } else if (msg.type === "control" && msg.state) {
            setControl(msg.state);
            term.options.disableStdin = msg.state !== "granted";
            term.options.cursorBlink = msg.state === "granted";
            if (msg.state === "granted") term.focus();
          }
        };
        ws.onclose = () => {
          if (!closedByUs) setStatus("closed");
          setControl("none");
          term.options.disableStdin = true;
        };
        ws.onerror = () => setStatus("error");
      } catch {
        setStatus("error");
      }
    })();
    return () => {
      closedByUs = true;
      ws?.close();
      wsRef.current = null;
    };
  }, [session, userId, trpc]);

  const sendControl = (type: "request-control" | "release-control") => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type }));
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        {control === "granted" ? (
          <Keyboard className="size-3.5 text-sky-400" />
        ) : (
          <Eye className="size-3.5" />
        )}
        {status === "live" ? (
          <>
            {control === "granted"
              ? "You are typing in the student's terminal"
              : "Watching live (read-only)"}
            {cwd && (
              <code className="font-mono">
                {cwd.replace(/^\/home\/student/, "~")}
              </code>
            )}
          </>
        ) : status === "waiting" ? (
          "No terminal open — it shows up here as soon as the student opens one."
        ) : status === "connecting" ? (
          "Connecting…"
        ) : (
          "Disconnected."
        )}
        <span className="ml-auto flex items-center gap-2">
          {control === "pending" && "Waiting for the student to allow it…"}
          {control === "denied" && (
            <span className="text-amber-400">The student said no.</span>
          )}
          {control === "busy" && (
            <span className="text-amber-400">
              Another teacher is asking or typing.
            </span>
          )}
          {status === "live" &&
            (control === "granted" || control === "pending" ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-7"
                onClick={() => sendControl("release-control")}
              >
                {control === "granted" ? "Give control back" : "Cancel"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="h-7"
                onClick={() => sendControl("request-control")}
                title="Asks the student; you can only type once they allow it."
              >
                <Hand /> Take over
              </Button>
            ))}
        </span>
      </div>
      <div
        className={cn(
          "relative overflow-auto rounded-lg border bg-[#0a0a0a] p-2",
          control === "granted" && "border-sky-400/60",
        )}
      >
        <div ref={hostRef} className="min-h-[18rem]" />
        {(status === "connecting" ||
          status === "closed" ||
          status === "error") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            {status === "connecting" ? (
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSession((s) => s + 1)}
              >
                <RotateCw /> Reconnect
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        The student sees that you are watching. Commands you type while in
        control are logged as theirs.
      </p>
    </div>
  );
}
