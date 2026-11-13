import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { api } from "~/trpc/server";
import { LiveView } from "./live-view";

export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await api.manage
    .live({ assignmentId: id })
    .catch((e: unknown) => {
      if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
      throw e;
    });
  return <LiveView initial={data} />;
}
