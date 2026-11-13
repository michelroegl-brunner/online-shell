import type { WebSocket } from "ws";

/**
 * Read-only "watch" of a student's terminal for teachers.
 *
 * Every student terminal registers a Session here. Its output goes to the
 * student as before and is also kept in a small ring buffer and fanned out
 * to watchers. A watcher follows one student (not one terminal): it sees
 * the most recently opened terminal of that student and switches when that
 * one closes or a new one opens. Watchers can't send input.
 *
 * The student is told how many people are watching (`{type:"watched"}`),
 * so watching is never secret.
 *
 * Protocol to the watcher (text frames are JSON, binary = terminal bytes):
 *   {type:"session", cwd, cols, rows}  a terminal is shown; the replayed
 *                                      scrollback follows as binary
 *   {type:"size", cols, rows}          the student's terminal was resized
 *   {type:"waiting"}                   no terminal open right now
 */

const RING_BYTES = 128 * 1024;

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
};

const sessionsByUser = new Map<string, Session[]>();
const watchersByUser = new Map<string, Set<WebSocket>>();
/** Which session each watcher currently sees. */
const watching = new WeakMap<WebSocket, number>();
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

/** Show `s` (or "waiting") to one watcher, replaying the scrollback. */
function show(ws: WebSocket, s: Session | undefined) {
  if (!s) {
    watching.delete(ws);
    sendJson(ws, { type: "waiting" });
    return;
  }
  watching.set(ws, s.id);
  sendJson(ws, { type: "session", cwd: s.cwd, cols: s.cols, rows: s.rows });
  if (s.bytes > 0 && ws.readyState === ws.OPEN) {
    ws.send(Buffer.concat(s.chunks), { binary: true });
  }
}

export function openSession(
  userId: string,
  cwd: string,
  cols: number,
  rows: number,
  student: WebSocket,
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
    if (watching.get(w) === s.id && w.readyState === w.OPEN) {
      w.send(chunk, { binary: true });
    }
  }
}

export function sessionResize(s: Session, cols: number, rows: number) {
  s.cols = cols;
  s.rows = rows;
  for (const w of watchersByUser.get(s.userId) ?? []) {
    if (watching.get(w) === s.id) sendJson(w, { type: "size", cols, rows });
  }
}

export function closeSession(s: Session) {
  const list = (sessionsByUser.get(s.userId) ?? []).filter((x) => x !== s);
  if (list.length) sessionsByUser.set(s.userId, list);
  else sessionsByUser.delete(s.userId);
  for (const w of watchersByUser.get(s.userId) ?? []) {
    if (watching.get(w) === s.id) show(w, latest(s.userId));
  }
}

/** A teacher starts watching `userId`. Input from the watcher is ignored. */
export function addWatcher(userId: string, ws: WebSocket) {
  const set = watchersByUser.get(userId) ?? new Set<WebSocket>();
  set.add(ws);
  watchersByUser.set(userId, set);
  show(ws, latest(userId));
  tellStudent(userId);

  let alive = true;
  ws.on("pong", () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on("close", () => {
    clearInterval(ping);
    set.delete(ws);
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
  }));
}
