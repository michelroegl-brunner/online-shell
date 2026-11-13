import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { LEARN_NAV } from "~/lib/nav";
import { TestRunBanner } from "~/components/learn/test-run-banner";
import { getCurrentUser } from "~/server/auth/current-user";
import { api } from "~/trpc/server";
import { Workspace } from "./workspace";

export default async function ExercisePage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");
  const data = await api.learn.item({ itemId }).catch((e: unknown) => {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    // Not open yet: the API refuses to return the task.
    if (e instanceof TRPCError && e.code === "FORBIDDEN") redirect("/learn");
    throw e;
  });
  if (data.assignment.id !== id) notFound();

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        user={user}
        home={data.preview ? "/admin" : "/learn"}
        nav={LEARN_NAV}
      />
      {data.preview && (
        <TestRunBanner
          assignmentId={data.assignment.id}
          className="mx-4 mt-3 sm:mx-6"
        />
      )}
      {/* Remount per exercise so state (terminal, results) starts fresh. */}
      <Workspace key={itemId} initial={data} />
    </div>
  );
}
