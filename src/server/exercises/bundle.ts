import "server-only";

import { z } from "zod";

import { exerciseInput, stepInput, totalPoints } from "~/lib/exercise";
import { type db as Db } from "~/server/db";

/**
 * Exercise bundles: JSON files for sharing / versioning exercises.
 *   { "format": "online-shell-exercises", "version": 1, "exercises": [...] }
 * Exercises are matched by slug; steps by position (so student progress on
 * a step survives a re-import). The same logic is used by the CLI
 * (deploy/import-exercises.mjs) — keep them in sync.
 */

export const BUNDLE_FORMAT = "online-shell-exercises";

const bundleExercise = exerciseInput.extend({
  steps: z
    .array(stepInput.omit({ id: true }))
    .min(1)
    .max(20),
});

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(1),
  exercises: z.array(bundleExercise).min(1).max(200),
});

export type Bundle = z.infer<typeof bundleSchema>;
export type BundleExercise = z.infer<typeof bundleExercise>;

export type ImportResult = {
  created: string[];
  updated: string[];
  skipped: { slug: string; reason: string }[];
};

export async function importExercises(
  db: typeof Db,
  opts: {
    authorId: string;
    /** Admins may overwrite exercises of other authors. */
    isAdmin: boolean;
    exercises: BundleExercise[];
    overwrite: boolean;
  },
): Promise<ImportResult> {
  const result: ImportResult = { created: [], updated: [], skipped: [] };

  for (const ex of opts.exercises) {
    const { steps, ...fields } = ex;
    const points = totalPoints(steps);
    const existing = await db.exercise.findUnique({
      where: { slug: ex.slug },
      select: {
        id: true,
        authorId: true,
        steps: { orderBy: { order: "asc" }, select: { id: true } },
      },
    });

    if (!existing) {
      await db.exercise.create({
        data: {
          ...fields,
          points,
          authorId: opts.authorId,
          steps: { create: steps.map((s, order) => ({ ...s, order })) },
        },
      });
      result.created.push(ex.slug);
      continue;
    }

    if (!opts.overwrite) {
      result.skipped.push({ slug: ex.slug, reason: "already exists" });
      continue;
    }
    if (existing.authorId !== opts.authorId && !opts.isAdmin) {
      result.skipped.push({
        slug: ex.slug,
        reason: "belongs to another teacher",
      });
      continue;
    }

    await db.$transaction([
      db.exercise.update({
        where: { id: existing.id },
        data: { ...fields, points },
      }),
      // Steps by position: update the ones that exist, add the rest…
      ...steps.map((s, order) => {
        const stepId = existing.steps[order]?.id;
        return stepId
          ? db.exerciseStep.update({
              where: { id: stepId },
              data: { ...s, order },
            })
          : db.exerciseStep.create({
              data: { ...s, order, exerciseId: existing.id },
            });
      }),
      // …and remove surplus steps (their progress goes with them).
      db.exerciseStep.deleteMany({
        where: {
          id: { in: existing.steps.slice(steps.length).map((s) => s.id) },
        },
      }),
    ]);
    result.updated.push(ex.slug);
  }
  return result;
}

/** Build a bundle from exercises (step ids are not exported). */
export function toBundle(
  exercises: (Omit<BundleExercise, "steps"> & {
    steps: (BundleExercise["steps"][number] & { id?: string })[];
  })[],
): Bundle {
  return {
    format: BUNDLE_FORMAT,
    version: 1,
    exercises: exercises.map((e) => ({
      title: e.title,
      slug: e.slug,
      description: e.description,
      shell: e.shell,
      difficulty: e.difficulty,
      setupScript: e.setupScript,
      tags: e.tags,
      visibility: e.visibility,
      steps: e.steps.map((s) => ({
        title: s.title,
        description: s.description,
        checkScript: s.checkScript,
        checks: s.checks,
        hints: s.hints,
        points: s.points,
        requiresPrevious: s.requiresPrevious,
      })),
    })),
  };
}
