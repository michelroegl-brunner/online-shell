import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { parseChecks } from "~/lib/checks";
import { api } from "~/trpc/server";
import { ExerciseEditor } from "../exercise-editor";
import { ExerciseStats } from "./exercise-stats";

export default async function EditExercisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ex = await api.exercise.byId({ id }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  return (
    <div className="flex flex-col gap-6">
      <ExerciseEditor
        // Remount when switching between exercises.
        key={ex.id}
        id={ex.id}
        canEdit={ex.canEdit}
        archived={ex.archived}
        stepAttempts={Object.fromEntries(
          ex.steps.map((s) => [s.id, s.attemptCount]),
        )}
        initial={{
          title: ex.title,
          slug: ex.slug,
          description: ex.description,
          shell: ex.shell,
          kind: ex.kind,
          difficulty: ex.difficulty,
          setupScript: ex.setupScript,
          setupInternet: ex.setupInternet,
          tags: ex.tags,
          visibility: ex.visibility,
          steps: ex.steps.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            checkScript: s.checkScript,
            checks: parseChecks(s.checks),
            hints: s.hints,
            points: s.points,
            requiresPrevious: s.requiresPrevious,
            allowInternet: s.allowInternet,
          })),
        }}
      />
      <ExerciseStats exerciseId={ex.id} />
    </div>
  );
}
