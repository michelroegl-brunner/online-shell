import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { api } from "~/trpc/server";
import { CheatSheetEditor } from "../cheat-sheet-editor";

export default async function EditCheatSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sheet = await api.cheatsheet.byId({ id }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  return (
    <CheatSheetEditor
      // Remount when switching between sheets.
      key={sheet.id}
      id={sheet.id}
      canEdit={sheet.canEdit}
      archived={sheet.archived}
      author={sheet.author.name ?? undefined}
      initial={{
        title: sheet.title,
        slug: sheet.slug,
        shell: sheet.shell,
        tags: sheet.tags,
        body: sheet.body,
        order: sheet.order,
        visibility: sheet.visibility,
      }}
    />
  );
}
