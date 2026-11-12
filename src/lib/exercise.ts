import { z } from "zod";

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

export const exerciseInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  slug: z
    .string()
    .max(60)
    .regex(SLUG_RE, "Lowercase letters, digits and dashes only"),
  description: z.string().max(50_000),
  shell: z.enum(["BASH", "PWSH"]),
  difficulty: z.number().int().min(1).max(5),
  points: z.number().int().min(0).max(1000),
  setupScript: z.string().max(100_000),
  checkScript: z.string().max(100_000),
  hints: z.array(z.string().trim().min(1).max(1000)).max(20),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20),
  visibility: z.enum(["PRIVATE", "SHARED"]),
});

export type ExerciseInput = z.infer<typeof exerciseInput>;

/** Starting point for "New exercise". */
export const EXERCISE_TEMPLATE: ExerciseInput = {
  title: "Find the big log files",
  slug: "find-big-log-files",
  shell: "BASH",
  difficulty: 2,
  points: 10,
  visibility: "PRIVATE",
  tags: ["find", "sort"],
  hints: ["Look at `find -size`", "`sort -n` sorts numerically"],
  description: `In the folder \`logs/\` there are many log files.

Write the **names** of all files **larger than 1 MB** into \`big.txt\`,
sorted by size (smallest first), one per line.`,
  setupScript: `# Runs as root inside ~/exercises/<slug> ($OSHELL_DIR), with set -e.
# The folder is wiped before each run and chowned to the student after.
mkdir -p logs
for i in $(seq 1 20); do
  head -c $(( (RANDOM % 30) * 100000 )) /dev/urandom > "logs/app-$i.log"
done`,
  checkScript: `# Runs as root in $OSHELL_DIR after "Check".
# Exit 0 = passed. Whatever you print is shown to the student.
expected=$(find logs -type f -size +1M -printf '%s %f\\n' | sort -n | cut -d' ' -f2)
if [ ! -f big.txt ]; then
  echo "big.txt does not exist yet."
  exit 1
fi
if [ "$(cat big.txt)" != "$expected" ]; then
  echo "big.txt is not right yet. Check the size filter and the sort order."
  exit 1
fi
echo "Well done!"`,
};
