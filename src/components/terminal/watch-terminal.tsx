"use client";

import "@xterm/xterm/css/xterm.css";

import type { Terminal } from "@xterm/xterm";
import { Eye, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

type Status = "connecting" | "live" | "waiting" | "closed" | "error";

/**
 * Read-only view of a student's terminal (runner `/watch`). The terminal
 * takes the student's size; nothing typed here reaches their shell. The
 * student sees that they are being watched.
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
  const [status, setStatus] = useState<Status>("connecting");
  const [cwd, setCwd] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const trpc = api.useUtils().client;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => undefined as void;
    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 13,
        theme: { background: "#0a0a0a" },
        scrollback: 5000,
      });
      term.open(hostRef.current);
      termRef.current = term;
      cleanup = () => term.dispose();
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
    void (async () => {
      try {
        const { url, token } = await trpc.manage.watch.mutate({ userId });
        if (closedByUs) return;
        ws = new WebSocket(`${url}?${new URLSearchParams({ token })}`);
        ws.binaryType = "arraybuffer";
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
          }
        };
        ws.onclose = () => {
          if (!closedByUs) setStatus("closed");
        };
        ws.onerror = () => setStatus("error");
      } catch {
        setStatus("error");
      }
    })();
    return () => {
      closedByUs = true;
      ws?.close();
    };
  }, [session, userId, trpc]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Eye className="size-3.5" />
        {status === "live" ? (
          <>
            Watching live (read-only)
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
        <span className="ml-auto">The student sees that you are watching.</span>
      </div>
      <div className="relative overflow-auto rounded-lg border bg-[#0a0a0a] p-2">
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
    </div>
  );
}
