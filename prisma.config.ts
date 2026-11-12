import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` doesn't need a DB; only add the datasource when
// DATABASE_URL is set (so Docker builds without it don't crash).
const databaseUrl = process.env.DATABASE_URL;
// Optional. Needed with `prisma dev` (its DB is `template1`, which the
// default shadow DB would be cloned from): use its shadow server instead.
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: "./prisma/schema.prisma",
  ...(databaseUrl
    ? {
        datasource: {
          url: databaseUrl,
          ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
        },
      }
    : {}),
});
