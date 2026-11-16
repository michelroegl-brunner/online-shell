/**
 * Copy detection for one assignment: compares every pair of students and
 * collects evidence that they worked together or copied. Pure functions
 * (no DB) so the scoring is easy to follow and to test.
 *
 * Signals, strongest first:
 * - foreign values: a student typed ANOTHER student's per-student variable
 *   value (src/lib/variables.ts) — hard to explain without copying.
 * - shared mistakes: the same failing, non-trivial command that (almost)
 *   nobody else typed.
 * - shared rare commands: the same long command that (almost) nobody else
 *   typed.
 * - overlap: weighted Jaccard of their non-trivial commands, where common
 *   commands (the "obvious" answer) weigh little (IDF).
 * - close solves: the same steps solved within two minutes of each other.
 *
 * It is a pointer for the teacher, not proof.
 */

export type SimCommand = {
  itemId: string;
  command: string;
  exitCode: number | null;
};

export type SimStudent = {
  id: string;
  name: string;
  commands: SimCommand[];
  /** stepId → when it passed */
  passed: Map<string, Date>;
  /** itemId → this student's variable values */
  vars: Map<string, Record<string, string>>;
};

export type Evidence = {
  sharedMistakes: { command: string; itemId: string }[];
  sharedRare: { command: string; itemId: string }[];
  foreignValues: {
    /** Student who typed the other one's value. */
    by: "a" | "b";
    itemId: string;
    name: string;
    value: string;
    command: string;
  }[];
  closeSolves: { stepId: string; seconds: number }[];
  overlap: number;
};

export type Pair = Evidence & {
  a: { id: string; name: string };
  b: { id: string; name: string };
  score: number;
};

/** Commands that look around rather than solve something. */
export const TRIVIAL =
  /^(cd|ls|ll|la|l|pwd|clear|cls|history|exit|man|help|less|more|tree|whoami|nano|vi|vim|file|stat|wc|Get-ChildItem|gci|dir|Set-Location|sl|Get-Location|gl|Get-Help|Get-Content|gc|type)(\s|$)|^cat\s+\S+$|^echo \$\?$/i;
export const normalize = (c: string) => c.trim().replace(/\s+/g, " ");

const MIN_RARE_LEN = 15;
const MIN_MISTAKE_LEN = 8;
const CLOSE_SECONDS = 120;
/** Pairs below this score are not reported. */
export const REPORT_THRESHOLD = 20;

const key = (itemId: string, cmd: string) => `${itemId}\u0000${cmd}`;

/** Distinct non-trivial commands per student (per exercise). */
function commandSets(s: SimStudent) {
  const all = new Set<string>();
  const failed = new Set<string>();
  for (const c of s.commands) {
    const n = normalize(c.command);
    if (!n || TRIVIAL.test(n)) continue;
    all.add(key(c.itemId, n));
    if (c.exitCode !== null && c.exitCode !== 0) failed.add(key(c.itemId, n));
  }
  return { all, failed };
}

function split(k: string) {
  const i = k.indexOf("\u0000");
  return { itemId: k.slice(0, i), command: k.slice(i + 1) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Values of `owner` that `other` typed in the same exercise although their
 * own value differs. Only values of 3+ characters, matched as whole words.
 */
function foreignValues(owner: SimStudent, other: SimStudent) {
  const out: Omit<Evidence["foreignValues"][number], "by">[] = [];
  for (const [itemId, vars] of owner.vars) {
    const mine = other.vars.get(itemId) ?? {};
    for (const [name, value] of Object.entries(vars)) {
      if (value.length < 3 || mine[name] === value) continue;
      // Someone else in the class may share the value; only count it when
      // the typist's own value differs (checked above).
      const re = new RegExp(`(^|[^\\w])${escapeRe(value)}($|[^\\w])`);
      const hit = other.commands.find(
        (c) => c.itemId === itemId && re.test(c.command),
      );
      if (hit) {
        out.push({ itemId, name, value, command: normalize(hit.command) });
      }
    }
  }
  return out;
}

export function comparePairs(students: SimStudent[]): Pair[] {
  const n = students.length;
  if (n < 2) return [];
  const sets = students.map(commandSets);

  // How many students typed each command / made each mistake.
  const df = new Map<string, number>();
  const dfFailed = new Map<string, number>();
  for (const s of sets) {
    for (const k of s.all) df.set(k, (df.get(k) ?? 0) + 1);
    for (const k of s.failed) dfFailed.set(k, (dfFailed.get(k) ?? 0) + 1);
  }
  // "Rare": at most 2 students, or 10 % of a big class.
  const rareMax = Math.max(2, Math.floor(n * 0.1));
  const idf = (k: string) => Math.log((n + 1) / (df.get(k) ?? 1));

  const pairs: Pair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = students[i]!;
      const B = students[j]!;
      const sa = sets[i]!;
      const sb = sets[j]!;

      let inter = 0;
      let union = 0;
      const sharedRare: Evidence["sharedRare"] = [];
      const sharedMistakes: Evidence["sharedMistakes"] = [];
      for (const k of sa.all) {
        const w = idf(k);
        union += w;
        if (!sb.all.has(k)) continue;
        inter += w;
        const { itemId, command } = split(k);
        if (
          sa.failed.has(k) &&
          sb.failed.has(k) &&
          (dfFailed.get(k) ?? 0) <= rareMax &&
          command.length >= MIN_MISTAKE_LEN
        ) {
          sharedMistakes.push({ itemId, command });
        } else if (
          (df.get(k) ?? 0) <= rareMax &&
          command.length >= MIN_RARE_LEN
        ) {
          sharedRare.push({ itemId, command });
        }
      }
      for (const k of sb.all) if (!sa.all.has(k)) union += idf(k);
      const overlap = union > 0 ? inter / union : 0;

      const closeSolves: Evidence["closeSolves"] = [];
      for (const [stepId, at] of A.passed) {
        const other = B.passed.get(stepId);
        if (!other) continue;
        const seconds = Math.abs(at.getTime() - other.getTime()) / 1000;
        if (seconds <= CLOSE_SECONDS) {
          closeSolves.push({ stepId, seconds: Math.round(seconds) });
        }
      }

      const foreign: Evidence["foreignValues"] = [
        ...foreignValues(B, A).map((f) => ({ ...f, by: "a" as const })),
        ...foreignValues(A, B).map((f) => ({ ...f, by: "b" as const })),
      ];

      const score = Math.min(
        100,
        Math.round(
          40 * overlap +
            Math.min(30, 10 * sharedMistakes.length) +
            Math.min(20, 4 * sharedRare.length) +
            // One close solve happens by chance in a lab; several don't.
            (closeSolves.length >= 2
              ? Math.min(10, 3 * closeSolves.length)
              : 0) +
            Math.min(50, 25 * foreign.length),
        ),
      );
      pairs.push({
        a: { id: A.id, name: A.name },
        b: { id: B.id, name: B.name },
        score,
        overlap,
        sharedMistakes: sharedMistakes.slice(0, 10),
        sharedRare: sharedRare
          .sort((x, y) => y.command.length - x.command.length)
          .slice(0, 10),
        foreignValues: foreign.slice(0, 10),
        closeSolves,
      });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}
