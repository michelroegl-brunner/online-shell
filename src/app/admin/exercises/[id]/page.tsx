import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { api } from "~/trpc/server";
import { ExerciseEditor } from "../exercise-editor";

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
    <ExerciseEditor
      // Remount when switching between exercises.
      key={ex.id}
      id={ex.id}
      canEdit={ex.canEdit}
      archived={ex.archived}
      initial={{
        title: ex.title,
        slug: ex.slug,
        description: ex.description,
        shell: ex.shell,
        difficulty: ex.difficulty,
        points: ex.points,
        setupScript: ex.setupScript,
        checkScript: ex.checkScript,
        hints: ex.hints,
        tags: ex.tags,
        visibility: ex.visibility,
      }}
    />
  );
}
