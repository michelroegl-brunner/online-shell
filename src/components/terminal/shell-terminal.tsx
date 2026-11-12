"use client";

import "@xterm/xterm/css/xterm.css";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

type Status = "connecting" | "ready" | "closed" | "error";

/**
 * Browser terminal attached to the student's box via the runner WebSocket.
 * Binary frames carry terminal bytes; text frames carry JSON control.
 */
export function ShellTerminal({
  shell = "BASH",
  exercise,
  className,
}: {
  shell?: "BASH" | "PWSH";
  /** Exercise slug: start the shell in ~/exercises/<slug>. */
  exercise?: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [session, setSession] = useState(0); // bump to reconnect

  // Plain client call (stable reference) instead of useMutation state.
  const trpc = api.useUtils().client;

  // Create the xterm instance once.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => undefined as void;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 14,
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
      ro.observe(hostRef.current);
      cleanup = () => {
        ro.disconnect();
        term.dispose();
      };
      setSession((s) => s + 1); // first connect once the terminal exists
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  // (Re)connect whenever `session` changes.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || session === 0) return;

    let ws: WebSocket | null = null;
    let closedByUs = false;
    const disposables: { dispose(): void }[] = [];
    setStatus("connecting");

    void (async () => {
      try {
        const { url, token } = await trpc.box.attach.mutate({
          shell,
          exercise,
        });
        if (closedByUs) return;
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
          const msg = JSON.parse(String(ev.data)) as { type: string };
          if (msg.type === "ready") {
            setStatus("ready");
            term.focus();
          }
        };
        ws.onclose = () => {
          if (!closedByUs) setStatus("closed");
        };
        ws.onerror = () => setStatus("error");

        disposables.push(
          term.onData((d) => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(enc.encode(d));
          }),
          term.onResize(({ cols, rows }) => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "resize", cols, rows }));
            }
          }),
        );
      } catch {
        setStatus("error");
      }
    })();

    return () => {
      closedByUs = true;
      disposables.forEach((d) => d.dispose());
      ws?.close();
    };
  }, [session, shell, exercise, trpc]);

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
                  ? "Could not connect to the shell."
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
