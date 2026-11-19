import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { api } from "~/trpc/server";
import { TemplateEditor } from "../template-editor";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await api.template.byId({ id }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  return (
    <TemplateEditor
      key={`${t.id}:${t.updatedAt.getTime()}`}
      id={t.id}
      readOnly={!t.canEdit}
      owner={t.owner.name}
      hidden={t.hidden}
      initial={{
        title: t.title,
        description: t.description,
        mode: t.mode,
        maxChecks: t.maxChecks == null ? "" : String(t.maxChecks),
        allowHints: t.allowHints,
        hintPenalty: t.hintPenalty,
        allowCheatSheet: t.allowCheatSheet,
        allowPaste: t.allowPaste,
        durationMinutes:
          t.durationMinutes == null ? "" : String(t.durationMinutes),
        visibility: t.visibility,
        items: t.items.map((i) => ({
          exerciseId: i.exercise.id,
          title: i.exercise.title,
          slug: i.exercise.slug,
          shell: i.exercise.shell,
          kind: i.exercise.kind,
          defaultPoints: i.exercise.points,
          points: i.points == null ? "" : String(i.points),
          gate: i.gate,
          attempts: 0,
        })),
      }}
    />
  );
}
