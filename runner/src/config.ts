import { z } from "zod";

const schema = z.object({
  RUNNER_SECRET: z.string().min(16, "RUNNER_SECRET must be at least 16 chars"),
  PORT: z.coerce.number().int().positive().default(4100),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  /** Web app, internal URL: blocked paste attempts are reported there. */
  WEB_URL: z
    .string()
    .url()
    .default("http://localhost:3000")
    .transform((u) => u.replace(/\/+$/, "")),
  BASH_IMAGE: z.string().default("oshell-bash:latest"),
  PWSH_IMAGE: z.string().default("oshell-pwsh:latest"),
  IDLE_MINUTES: z.coerce.number().positive().default(15),
  MAX_LIFETIME_MINUTES: z.coerce.number().positive().default(120),
  BOX_MEMORY_MB: z.coerce.number().int().positive().default(256),
  BOX_CPUS: z.coerce.number().positive().default(0.5),
  BOX_PIDS: z.coerce.number().int().positive().default(128),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid runner config:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
