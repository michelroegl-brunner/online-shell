#!/usr/bin/env node
// Import an exercise bundle into the database (server-side, no login).
// Same rules as the UI import (src/server/exercises/bundle.ts — keep in
// sync): match by slug, steps by position, author = the given teacher.
//
// In production (inside the web container, files are in /app):
//   docker compose -p online-shell exec web \
//     node deploy/import-exercises.mjs content/exercises/powershell-htl.json teacher@htl-braunau.at [--overwrite]

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../generated/prisma/index.js");
const { PrismaPg } = require("@prisma/adapter-pg");

const [file, email, ...flags] = process.argv.slice(2);
const overwrite = flags.includes("--overwrite");
if (!file || !email) {
  console.error("usage: node deploy/import-exercises.mjs <bundle.json> <author-email> [--overwrite]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const bundle = JSON.parse(readFileSync(file, "utf8"));
if (bundle.format !== "online-shell-exercises" || bundle.version !== 1 || !Array.isArray(bundle.exercises)) {
  console.error("not an online-shell-exercises v1 bundle");
  process.exit(2);
}
for (const ex of bundle.exercises) {
  const ok =
    typeof ex.title === "string" && SLUG_RE.test(ex.slug ?? "") &&
    ["BASH", "PWSH"].includes(ex.shell) && Array.isArray(ex.steps) && ex.steps.length > 0 &&
    ex.steps.every((s) => typeof s.title === "string" && typeof s.checkScript === "string" && Number.isInteger(s.points));
  if (!ok) {
    console.error(`invalid exercise: ${ex.slug ?? ex.title}`);
    process.exit(2);
  }
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const author = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, role: true } });
  if (!author || author.role === "STUDENT") {
    console.error(`no teacher/admin with email ${email} (sign in once first)`);
    process.exit(1);
  }
  const isAdmin = author.role === "ADMIN";

  const pickStep = (s, order) => ({
    title: s.title,
    description: s.description ?? "",
    checkScript: s.checkScript,
    checks: Array.isArray(s.checks) ? s.checks : [],
    hints: s.hints ?? [],
    points: s.points,
    requiresPrevious: s.requiresPrevious ?? true,
    order,
  });

  for (const ex of bundle.exercises) {
    const fields = {
      title: ex.title,
      slug: ex.slug,
      description: ex.description ?? "",
      shell: ex.shell,
      difficulty: ex.difficulty ?? 1,
      setupScript: ex.setupScript ?? "",
      tags: ex.tags ?? [],
      visibility: ex.visibility ?? "PRIVATE",
      points: ex.steps.reduce((sum, s) => sum + s.points, 0),
    };
    const existing = await db.exercise.findUnique({
      where: { slug: ex.slug },
      select: { id: true, authorId: true, steps: { orderBy: { order: "asc" }, select: { id: true } } },
    });

    if (!existing) {
      await db.exercise.create({
        data: { ...fields, authorId: author.id, steps: { create: ex.steps.map(pickStep) } },
      });
      console.log(`created  ${ex.slug} (${ex.steps.length} steps)`);
      continue;
    }
    if (!overwrite) {
      console.log(`skipped  ${ex.slug} (exists; use --overwrite)`);
      continue;
    }
    if (existing.authorId !== author.id && !isAdmin) {
      console.log(`skipped  ${ex.slug} (belongs to another teacher)`);
      continue;
    }
    await db.$transaction([
      db.exercise.update({ where: { id: existing.id }, data: fields }),
      ...ex.steps.map((s, order) => {
        const stepId = existing.steps[order]?.id;
        return stepId
          ? db.exerciseStep.update({ where: { id: stepId }, data: pickStep(s, order) })
          : db.exerciseStep.create({ data: { ...pickStep(s, order), exerciseId: existing.id } });
      }),
      db.exerciseStep.deleteMany({ where: { id: { in: existing.steps.slice(ex.steps.length).map((s) => s.id) } } }),
    ]);
    console.log(`updated  ${ex.slug} (${ex.steps.length} steps)`);
  }
} finally {
  await db.$disconnect();
}
