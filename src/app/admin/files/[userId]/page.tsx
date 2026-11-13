import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { FileBrowser } from "~/components/files/file-browser";
import { api } from "~/trpc/server";

/** A student's home folder (teachers of one of the student's classes). */
export default async function StudentFilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { userId } = await params;
  const { path } = await searchParams;
  const owner = await api.files.owner({ userId }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Files of {owner.name}</h1>
        <p className="text-muted-foreground text-sm">
          Read-only view of {owner.self ? "your" : "the student's"} home folder
          ({owner.email}).
        </p>
      </div>
      <FileBrowser userId={userId} initialPath={path ?? ""} />
    </div>
  );
}
