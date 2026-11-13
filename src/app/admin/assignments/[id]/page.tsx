import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { api } from "~/trpc/server";
import { AssignmentEditor } from "../assignment-editor";

export default async function EditAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const a = await api.assignment.byId({ id }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  return (
    <AssignmentEditor
      key={`${a.id}:${a.updatedAt.getTime()}`}
      id={a.id}
      attemptCount={a.attemptCount}
      initial={{
        title: a.title,
        classId: a.classId,
        groupIds: a.groupIds,
        opensAt: a.opensAt,
        dueAt: a.dueAt,
        maxChecks: a.maxChecks,
        allowHints: a.allowHints,
        allowPaste: a.allowPaste,
        published: a.published,
        publishAt: a.publishAt,
        mode: a.mode,
        items: a.items.map((i) => ({
          exerciseId: i.exercise.id,
          title: i.exercise.title,
          slug: i.exercise.slug,
          shell: i.exercise.shell,
          defaultPoints: i.exercise.points,
          points: i.points == null ? "" : String(i.points),
          attempts: i.attempts,
        })),
      }}
    />
  );
}
