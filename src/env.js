import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    AUTH_SECRET: z.string().min(1),
    APP_URL: z
      .string()
      .url()
      .transform((u) => u.replace(/\/+$/, "")),
    // Entra app registration. Optional so the app boots before it exists
    // (dev login only); the Microsoft button is hidden when unset.
    AUTH_MICROSOFT_ENTRA_ID_ID: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().optional(),
    AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: z.string().optional(),
    // Comma-separated Entra group object ids whose (transitive) members get
    // ADMIN on sign-in, in addition to the "Admin" app role.
    ENTRA_ADMIN_GROUP_IDS: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    // Dev-only login: pick a role without Entra. Never active in production.
    AUTH_DEV_LOGIN: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Runner service (runner/). RUNNER_URL: internal HTTP API (server only).
    // RUNNER_PUBLIC_URL: what the BROWSER uses for the terminal WebSocket.
    RUNNER_URL: z.string().url().default("http://localhost:4100"),
    RUNNER_PUBLIC_URL: z.string().url().default("ws://localhost:4100"),
    RUNNER_SECRET: z.string().min(16),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    AUTH_MICROSOFT_ENTRA_ID_ID: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
    AUTH_MICROSOFT_ENTRA_ID_SECRET: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
    AUTH_MICROSOFT_ENTRA_ID_TENANT_ID:
      process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
    ENTRA_ADMIN_GROUP_IDS: process.env.ENTRA_ADMIN_GROUP_IDS,
    AUTH_DEV_LOGIN: process.env.AUTH_DEV_LOGIN,
    RUNNER_URL: process.env.RUNNER_URL,
    RUNNER_PUBLIC_URL: process.env.RUNNER_PUBLIC_URL,
    RUNNER_SECRET: process.env.RUNNER_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
