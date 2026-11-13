import { z } from "zod";

import { SLUG_RE } from "~/lib/exercise";

// Shared (client + server) cheat sheet validation. No server-only imports:
// the admin editor validates with the same schema.

export const cheatSheetInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  slug: z
    .string()
    .max(60)
    .regex(SLUG_RE, "Lowercase letters, digits and dashes only"),
  shell: z.enum(["BASH", "PWSH"]),
  /** Shown on exercises that have at least one of these tags. */
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .min(1, "Add at least one tag, otherwise no exercise shows the sheet")
    .max(30),
  /** Markdown */
  body: z.string().max(100_000),
  /** Lower first */
  order: z.number().int().min(-1000).max(1000),
  visibility: z.enum(["PRIVATE", "SHARED"]),
});

export type CheatSheetInput = z.infer<typeof cheatSheetInput>;

export const CHEAT_SHEET_TEMPLATE: CheatSheetInput = {
  title: "",
  slug: "",
  shell: "BASH",
  tags: [],
  body: `## Abschnitt

| Befehl | Bedeutung |
|---|---|
| \`ls -l\` | Dateien ausführlich auflisten |

\`\`\`bash
echo "Hallo"
\`\`\`
`,
  order: 0,
  visibility: "SHARED",
};
