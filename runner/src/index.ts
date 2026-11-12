import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";

import {
  type AttachClaims,
  isAuthorizedApiCall,
  verifyAttachToken,
} from "./auth.js";
import {
  docker,
  ensureBox,
  execIn,
  HttpError,
  openPty,
  reap,
  removeBox,
  touch,
} from "./boxes.js";
import { config } from "./config.js";

// ── small HTTP helpers ──

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 256 * 1024) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

const shellSchema = z.enum(["BASH", "PWSH"]);
const createBoxBody = z.object({ userId: z.string(), shell: shellSchema });
const execBody = z.object({
  /** Script source, run via `bash -c` or `pwsh -Command`. */
  script: z.string().max(100_000),
  interpreter: z.enum(["bash", "pwsh"]).default("bash"),
  user: z.enum(["root", "student"]).default("student"),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  workdir: z.string().startsWith("/").optional(),
});

// ── internal REST API (web app only, bearer RUNNER_SECRET) ──

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://runner");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/health") {
    const dockerOk = await docker.ping().then(
      () => true,
      () => false,
    );
    return send(res, dockerOk ? 200 : 503, { ok: dockerOk });
  }

  if (!isAuthorizedApiCall(req))
    return send(res, 401, { error: "unauthorized" });

  // POST /boxes  { userId, shell }
  if (req.method === "POST" && parts.length === 1 && parts[0] === "boxes") {
    const body = createBoxBody.parse(await readJson(req));
    const box = await ensureBox(body.userId, body.shell);
    return send(res, 200, { box });
  }

  // POST /boxes/:userId/exec  { script, interpreter, user, timeoutMs }
  if (
    req.method === "POST" &&
    parts.length === 3 &&
    parts[0] === "boxes" &&
    parts[2] === "exec"
  ) {
    const userId = parts[1]!;
    const body = execBody.parse(await readJson(req));
    const cmd =
      body.interpreter === "pwsh"
        ? ["pwsh", "-NoLogo", "-NonInteractive", "-Command", body.script]
        : ["bash", "-c", body.script];
    touch(userId);
    const result = await execIn(userId, {
      cmd,
      user: body.user,
      timeoutMs: body.timeoutMs,
      workdir: body.workdir,
    });
    return send(res, 200, result);
  }

  // DELETE /boxes/:userId
  if (req.method === "DELETE" && parts.length === 2 && parts[0] === "boxes") {
    await removeBox(parts[1]!);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    if (err instanceof HttpError)
      return send(res, err.status, { error: err.message });
    if (err instanceof z.ZodError)
      return send(res, 400, { error: err.flatten() });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return send(res, 404, { error: "box not found" });
    console.error("[http]", err);
    send(res, 500, { error: "internal error" });
  });
});

// ── terminal WebSocket: /attach?token=…&cols=…&rows=… ──
// Protocol: binary frames = terminal bytes (both directions);
// text frames client→server = JSON control ({type:"resize",cols,rows});
// text frames server→client = JSON status ({type:"ready"} / {type:"exit"}).

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://runner");
  const origin = req.headers.origin ?? "";
  if (url.pathname !== "/attach" || !config.ALLOWED_ORIGINS.includes(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  verifyAttachToken(url.searchParams.get("token") ?? "").then(
    (claims) =>
      wss.handleUpgrade(req, socket, head, (ws) => {
        void attach(ws, claims, url.searchParams);
      }),
    () => {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    },
  );
});

/**
 * Typing sends one key (or one escape sequence) per message; a paste
 * arrives as one big chunk, often wrapped in bracketed-paste markers.
 * Terminal replies (device attributes, OSC colour answers) start with ESC
 * and may be longer, so those are let through.
 */
const PASTE_START = Buffer.from("\x1b[200~");
const MAX_TYPED_BYTES = 24;
function looksPasted(buf: Buffer) {
  if (buf.includes(PASTE_START)) return true;
  return buf.length > MAX_TYPED_BYTES && buf[0] !== 0x1b;
}

const resizeMsg = z.object({
  type: z.literal("resize"),
  cols: z.number(),
  rows: z.number(),
});

async function attach(
  ws: WebSocket,
  { userId, shell, cwd, allowPaste }: AttachClaims,
  params: URLSearchParams,
) {
  const cols = Number(params.get("cols") ?? 80);
  const rows = Number(params.get("rows") ?? 24);

  let pty;
  try {
    pty = await openPty(userId, shell, cols, rows, cwd);
  } catch (err) {
    console.error("[attach] failed", err);
    ws.close(1011, "could not start box");
    return;
  }
  const { stream, resize, release } = pty;
  ws.send(JSON.stringify({ type: "ready" }));

  stream.on("data", (chunk: Buffer) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  stream.on("end", () => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit" }));
      ws.close(1000, "shell exited");
    }
  });
  stream.on("error", () => ws.close(1011, "stream error"));

  ws.on("message", (data: RawData, isBinary: boolean) => {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (isBinary) {
      if (!allowPaste && looksPasted(buf)) {
        // The browser already blocks paste; this catches clients that don't.
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "paste-blocked" }));
        }
        return;
      }
      touch(userId);
      stream.write(buf);
      return;
    }
    try {
      const msg = resizeMsg.parse(JSON.parse(buf.toString("utf8")));
      void resize(msg.cols, msg.rows);
    } catch {
      /* ignore unknown control messages */
    }
  });

  // Keep-alive so proxies don't drop idle terminals.
  let alive = true;
  ws.on("pong", () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on("close", () => {
    clearInterval(ping);
    stream.end();
    release();
  });
}

// ── start ──

server.listen(config.PORT, () => {
  console.log(`[runner] listening on :${config.PORT}`);
});

setInterval(() => {
  reap().catch((e: unknown) => console.error("[reaper]", e));
}, 60_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[runner] ${sig}, shutting down (boxes keep running)`);
    server.close();
    process.exit(0);
  });
}
