import { z } from "zod";

import { stepChecks } from "./checks";

// Shared (client + server) exercise validation.

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * One step of an exercise. All steps share the exercise folder (setup runs
 * once), so later steps can build on what the student did before.
 */
export const stepInput = z.object({
  /** Existing step id (keeps student progress when editing); omit for new. */
  id: z.string().optional(),
  title: z.string().trim().min(1, "Step title is required").max(200),
  /** Markdown */
  description: z.string().max(50_000),
  checkScript: z.string().max(100_000),
  /** Ready-made checks (src/lib/checks.ts); all must pass. */
  checks: stepChecks.default([]),
  hints: z.array(z.string().trim().min(1).max(1000)).max(20),
  points: z.number().int().min(0).max(1000),
  /** Locked until the previous step is solved. Ignored for the first step. */
  requiresPrevious: z.boolean(),
});

export const exerciseInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  slug: z
    .string()
    .max(60)
    .regex(SLUG_RE, "Lowercase letters, digits and dashes only"),
  /** Markdown intro shown above the steps */
  description: z.string().max(50_000),
  shell: z.enum(["BASH", "PWSH"]),
  difficulty: z.number().int().min(1).max(5),
  setupScript: z.string().max(100_000),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20),
  visibility: z.enum(["PRIVATE", "SHARED"]),
  steps: z
    .array(stepInput)
    .min(1, "An exercise needs at least one step")
    .max(20),
});

export type StepInput = z.infer<typeof stepInput>;
export type ExerciseInput = z.infer<typeof exerciseInput>;

/** Exercise total = sum of its steps. */
export const totalPoints = (steps: { points: number }[]) =>
  steps.reduce((s, x) => s + x.points, 0);

export const EMPTY_STEP: StepInput = {
  title: "New step",
  description: "",
  checkScript: "# Exit 0 = passed. Print feedback for the student.\n",
  checks: [],
  hints: [],
  points: 10,
  requiresPrevious: true,
};

/** Starting point for "New exercise": a chained exercise with 3 steps. */
export const EXERCISE_TEMPLATE: ExerciseInput = {
  title: "Log files: count, find, archive",
  slug: "log-files-count-find-archive",
  shell: "BASH",
  difficulty: 2,
  visibility: "PRIVATE",
  tags: ["find", "sort", "tar"],
  description: `In the folder \`logs/\` there are many log files.
Work through the steps one by one; each step builds on the previous one.`,
  setupScript: `# Runs ONCE as root inside ~/exercises/<slug> ($OSHELL_DIR), with set -e.
# All steps share this folder. "Reset" wipes it and runs this again.
mkdir -p logs
for i in $(seq 1 20); do
  head -c $(( (RANDOM % 30) * 100000 )) /dev/urandom > "logs/app-$i.log"
done
echo "not a log" > logs/README.txt`,
  steps: [
    {
      title: "Count the log files",
      description:
        "Write the number of `.log` files in `logs/` into `count.txt` (just the number).",
      checkScript: `# Runs as root in $OSHELL_DIR. Exit 0 = passed; output is shown to the student.
expected=$(find logs -maxdepth 1 -type f -name '*.log' | wc -l)
[ -f count.txt ] || { echo "count.txt does not exist yet."; exit 1; }
if [ "$(tr -d '[:space:]' < count.txt)" != "$expected" ]; then
  echo "The number in count.txt is not right. Only count .log files."
  exit 1
fi
echo "Correct: $expected log files."`,
      checks: [],
      hints: ["`ls logs/*.log` lists them", "`wc -l` counts lines"],
      points: 5,
      requiresPrevious: true,
    },
    {
      title: "Find the big ones",
      description: `Write the **names** of all \`.log\` files **larger than 1 MB** into \`big.txt\`,
sorted by size (smallest first), one per line.`,
      checkScript: `expected=$(find logs -type f -name '*.log' -size +1M -printf '%s %f\\n' | sort -n | cut -d' ' -f2)
[ -f big.txt ] || { echo "big.txt does not exist yet."; exit 1; }
if [ "$(cat big.txt)" != "$expected" ]; then
  echo "big.txt is not right yet. Check the size filter and the sort order."
  exit 1
fi
echo "Well done!"`,
      checks: [],
      hints: ["Look at `find -size`", "`sort -n` sorts numerically"],
      points: 10,
      requiresPrevious: true,
    },
    {
      title: "Archive them",
      description:
        "Create `big-logs.tar.gz` that contains exactly the files listed in `big.txt` (inside `logs/`).",
      checkScript: `[ -f big-logs.tar.gz ] || { echo "big-logs.tar.gz does not exist yet."; exit 1; }
got=$(tar -tzf big-logs.tar.gz 2>/dev/null | xargs -n1 basename 2>/dev/null | sort)
want=$(sort big.txt)
if [ "$got" != "$want" ]; then
  echo "The archive doesn't contain exactly the files from big.txt."
  exit 1
fi
echo "Archive looks good!"`,
      checks: [],
      hints: [
        "`tar -czf archive.tar.gz files…`",
        "`$(cat big.txt)` gives you the names; they are in `logs/`",
      ],
      points: 10,
      requiresPrevious: true,
    },
  ],
};
