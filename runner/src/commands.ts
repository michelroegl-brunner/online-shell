/**
 * Live command stream.
 *
 * Besides appending to /run/oshell/cmd.log (which the web app ingests into
 * CommandLog), the shell hooks print every finished command as a private
 * OSC sequence to the terminal:
 *
 *   ESC ] 7337 ; base64("<epoch>\t<exit>\t<cwd>\t<command>") BEL
 *
 * The runner picks these out of the PTY output, strips them (neither the
 * student nor watchers see them) and keeps each student's recent commands
 * in memory for the teacher's live view — no extra process per box and no
 * waiting for the next ingest.
 *
 * Like cmd.log this is written by the student's shell, so a student could
 * fake it: it's a live hint for the teacher, not an audit trail.
 */

const START = Buffer.from("\x1b]7337;");
const BEL = 0x07;
/**
 * Longest payload we accept, in base64 chars (~3 KB of command line).
 * Anything that isn't strict base64 up to BEL within this many bytes is not
 * a marker and passes through untouched, so a student can't use a fake
 * marker to hide large parts of their output from a watching teacher.
 */
const MAX_PAYLOAD = 4096;
/** A held-back partial marker is released after this long. */
const FLUSH_MS = 40;
const RECENT = 30;

export type LiveCommand = {
  at: number;
  exitCode: number | null;
  cwd: string;
  command: string;
};

const recentByUser = new Map<string, LiveCommand[]>();

export function recentCommands(userId: string): LiveCommand[] {
  return recentByUser.get(userId) ?? [];
}

function record(userId: string, payload: string) {
  let line: string;
  try {
    line = Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return;
  }
  // The shell's own timestamp is ignored: the receive time can't be faked
  // (a future date would otherwise pin a fake "last command" / hide idling).
  const [, exit, cwd, ...rest] = line.split("\t");
  const command = rest.join("\t").trim();
  if (!cwd?.startsWith("/home/student") || !command) return;
  const exitCode = Number.parseInt(exit ?? "", 10);
  const list = recentByUser.get(userId) ?? [];
  list.push({
    at: Date.now(),
    exitCode:
      Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255
        ? exitCode
        : null,
    cwd,
    command: command.slice(0, 2000),
  });
  if (list.length > RECENT) list.splice(0, list.length - RECENT);
  recentByUser.set(userId, list);
}

/** A–Z a–z 0–9 + / = */
const isB64 = (c: number) =>
  (c >= 0x41 && c <= 0x5a) ||
  (c >= 0x61 && c <= 0x7a) ||
  (c >= 0x30 && c <= 0x39) ||
  c === 0x2b ||
  c === 0x2f ||
  c === 0x3d;

/** Length of the longest suffix of `buf` that is a prefix of START. */
function partialMarker(buf: Buffer) {
  for (let k = Math.min(START.length - 1, buf.length); k > 0; k--) {
    if (buf.subarray(buf.length - k).equals(START.subarray(0, k))) return k;
  }
  return 0;
}

/**
 * Per-terminal filter: feed PTY chunks in, get the cleaned bytes out via
 * `emit`. A marker split across chunks is held back briefly.
 */
export function commandSniffer(userId: string, emit: (b: Buffer) => void) {
  let carry: Buffer = Buffer.alloc(0);
  let timer: NodeJS.Timeout | undefined;

  const flushCarry = () => {
    timer = undefined;
    if (carry.length) {
      const b = carry;
      carry = Buffer.alloc(0);
      emit(b);
    }
  };

  return (chunk: Buffer) => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    carry = Buffer.alloc(0);
    const out: Buffer[] = [];
    let i = 0;
    for (;;) {
      const s = buf.indexOf(START, i);
      if (s === -1) {
        const keep = partialMarker(buf.subarray(i));
        out.push(buf.subarray(i, buf.length - keep));
        if (keep) carry = Buffer.from(buf.subarray(buf.length - keep));
        break;
      }
      out.push(buf.subarray(i, s));
      // Strict: base64 chars only, then BEL, within MAX_PAYLOAD.
      const from = s + START.length;
      let j = from;
      while (j < buf.length && j - from < MAX_PAYLOAD && isB64(buf[j]!)) j++;
      if (j < buf.length && buf[j] === BEL) {
        record(userId, buf.subarray(from, j).toString("latin1"));
        i = j + 1;
        continue;
      }
      if (j === buf.length && j - from < MAX_PAYLOAD) {
        carry = Buffer.from(buf.subarray(s)); // may continue in the next chunk
        break;
      }
      // Not a marker: pass the start sequence through and keep scanning.
      out.push(buf.subarray(s, from));
      i = from;
    }
    const cleaned = out.length === 1 ? out[0]! : Buffer.concat(out);
    if (cleaned.length) emit(cleaned);
    if (carry.length) timer = setTimeout(flushCarry, FLUSH_MS);
  };
}
