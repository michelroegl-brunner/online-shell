import type { RawData, WebSocket } from "ws";
import { z } from "zod";

import { recentCommands } from "./commands.js";

/**
 * Teachers watching (and, with consent, typing in) a student's terminal.
 *
 * Every student terminal registers a Session here. Its output goes to the
 * student as before and is also kept in a small ring buffer and fanned out
 * to watchers. A watcher follows one student (not one terminal): it sees
 * the most recently opened terminal of that student and switches when that
 * one closes or a new one opens.
 *
 * Watching is never secret: the student is told how many people watch
 * (`{type:"watched"}`).
 *
 * Take over: a watcher may ask for control. The student's terminal shows the
 * request; only if the student allows it are the watcher's keystrokes
 * written to that terminal. The student can take control back at any time,
 * the watcher can release it, and it ends when either side disconnects or
 * the watcher switches to another terminal. One controller per terminal.
 *
 * Protocol to the watcher (text frames are JSON, binary = terminal bytes):
 *   {type:"session", cwd, cols, rows}  a terminal is shown; the replayed
 *                                      scrollback follows as binary
 *   {type:"size", cols, rows}          the student's terminal was resized
 *   {type:"waiting"}                   no terminal open right now
 *   {type:"control", state}            none | pending | granted | denied | busy
 * From the watcher:
 *   binary                             keystrokes (only used while granted)
 *   {type:"request-control"} / {type:"release-control"}
 * To the student:
 *   {type:"control-request", by}       show "allow / deny"
 *   {type:"control", active, by}       a teacher is (no longer) typing
 * From the student (see index.ts): control-response {allow}, control-revoke.
 */

const RING_BYTES = 128 * 1024;

export type Watcher = { ws: WebSocket; name: string };

export type Session = {
  id: number;
  userId: string;
  cwd: string;
  cols: number;
  rows: number;
  startedAt: number;
  chunks: Buffer[];
  bytes: number;
  student: WebSocket;
  /** Writes into the student's shell. */
  write: (b: Buffer) => void;
  pending: Watcher | null;
  controller: Watcher | null;
};

const sessionsByUser = new Map<string, Session[]>();
const watchersByUser = new Map<string, Set<Watcher>>();
/** Which session each watcher currently sees. */
const watching = new WeakMap<Watcher, Session>();
let nextId = 1;

const sendJson = (ws: WebSocket, msg: unknown) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

const latest = (userId: string) => sessionsByUser.get(userId)?.at(-1);

function tellStudent(userId: string) {
  const count = watchersByUser.get(userId)?.size ?? 0;
  for (const s of sessionsByUser.get(userId) ?? []) {
    sendJson(s.student, { type: "watched", count });
  }
}

/** End a pending request / active control of `w` on its session. */
function dropControl(w: Watcher, notifyWatcher = true) {
  const s = watching.get(w);
  if (!s) return;
  if (s.pending === w) {
    s.pending = null;
    sendJson(s.student, { type: "control-request", by: null });
  }
  if (s.controller === w) {
    s.controller = null;
    sendJson(s.student, { type: "control", active: false, by: w.name });
  }
  if (notifyWatcher) sendJson(w.ws, { type: "control", state: "none" });
}

/** Show `s` (or "waiting") to one watcher, replaying the scrollback. */
function show(w: Watcher, s: Session | undefined) {
  dropControl(w);
  if (!s) {
    watching.delete(w);
    sendJson(w.ws, { type: "waiting" });
    return;
  }
  watching.set(w, s);
  sendJson(w.ws, { type: "session", cwd: s.cwd, cols: s.cols, rows: s.rows });
  if (s.bytes > 0 && w.ws.readyState === w.ws.OPEN) {
    w.ws.send(Buffer.concat(s.chunks), { binary: true });
  }
}

export function openSession(
  userId: string,
  cwd: string,
  cols: number,
  rows: number,
  student: WebSocket,
  write: (b: Buffer) => void,
): Session {
  const s: Session = {
    id: nextId++,
    userId,
    cwd,
    cols,
    rows,
    startedAt: Date.now(),
    chunks: [],
    bytes: 0,
    student,
    write,
    pending: null,
    controller: null,
  };
  const list = sessionsByUser.get(userId) ?? [];
  list.push(s);
  sessionsByUser.set(userId, list);
  // Watchers follow the newest terminal.
  for (const w of watchersByUser.get(userId) ?? []) show(w, s);
  const count = watchersByUser.get(userId)?.size ?? 0;
  if (count) sendJson(student, { type: "watched", count });
  return s;
}

export function sessionOutput(s: Session, chunk: Buffer) {
  s.chunks.push(chunk);
  s.bytes += chunk.length;
  while (s.bytes > RING_BYTES && s.chunks.length > 1) {
    s.bytes -= s.chunks.shift()!.length;
  }
  for (const w of watchersByUser.get(s.userId) ?? []) {
    if (watching.get(w) === s && w.ws.readyState === w.ws.OPEN) {
      w.ws.send(chunk, { binary: true });
    }
  }
}

export function sessionResize(s: Session, cols: number, rows: number) {
  s.cols = cols;
  s.rows = rows;
  for (const w of watchersByUser.get(s.userId) ?? []) {
    if (watching.get(w) === s) sendJson(w.ws, { type: "size", cols, rows });
  }
}

export function closeSession(s: Session) {
  const list = (sessionsByUser.get(s.userId) ?? []).filter((x) => x !== s);
  if (list.length) sessionsByUser.set(s.userId, list);
  else sessionsByUser.delete(s.userId);
  for (const w of watchersByUser.get(s.userId) ?? []) {
    if (watching.get(w) === s) show(w, latest(s.userId));
  }
}

/** The student answered a control request. */
export function controlResponse(s: Session, allow: boolean) {
  const w = s.pending;
  if (!w) return;
  s.pending = null;
  if (!allow || watching.get(w) !== s) {
    sendJson(w.ws, { type: "control", state: "denied" });
    return;
  }
  s.controller = w;
  sendJson(w.ws, { type: "control", state: "granted" });
  sendJson(s.student, { type: "control", active: true, by: w.name });
}

/** The student takes control back. */
export function controlRevoke(s: Session) {
  const w = s.controller;
  if (!w) return;
  s.controller = null;
  sendJson(w.ws, { type: "control", state: "none" });
  sendJson(s.student, { type: "control", active: false, by: w.name });
}

const watcherMsg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request-control") }),
  z.object({ type: z.literal("release-control") }),
]);

/** A teacher starts watching `userId`. */
export function addWatcher(userId: string, ws: WebSocket, name: string) {
  const w: Watcher = { ws, name };
  const set = watchersByUser.get(userId) ?? new Set<Watcher>();
  set.add(w);
  watchersByUser.set(userId, set);
  show(w, latest(userId));
  tellStudent(userId);

  ws.on("message", (data: RawData, isBinary: boolean) => {
    const s = watching.get(w);
    if (!s) return;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (isBinary) {
      // Keystrokes only while the student has handed over control.
      if (s.controller === w) s.write(buf);
      return;
    }
    let msg;
    try {
      msg = watcherMsg.parse(JSON.parse(buf.toString("utf8")));
    } catch {
      return;
    }
    if (msg.type === "release-control") {
      dropControl(w);
      return;
    }
    if (s.controller === w || s.pending === w) return;
    if (s.controller || s.pending) {
      sendJson(ws, { type: "control", state: "busy" });
      return;
    }
    s.pending = w;
    sendJson(ws, { type: "control", state: "pending" });
    sendJson(s.student, { type: "control-request", by: name });
  });

  let alive = true;
  ws.on("pong", () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on("close", () => {
    clearInterval(ping);
    dropControl(w, false);
    set.delete(w);
    if (set.size === 0) watchersByUser.delete(userId);
    tellStudent(userId);
  });
}

/** Students with at least one open terminal (for the live view). */
export function openTerminals() {
  return [...sessionsByUser.entries()].map(([userId, list]) => ({
    userId,
    terminals: list.length,
    cwd: list.at(-1)?.cwd ?? null,
    watchers: watchersByUser.get(userId)?.size ?? 0,
    controlled: list.some((s) => s.controller !== null),
    recent: recentCommands(userId),
  }));
}
