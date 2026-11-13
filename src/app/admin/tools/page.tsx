import { Suspense } from "react";

import { getCurrentUser } from "~/server/auth/current-user";
import { BoxTools } from "./box-tools";

export default async function ToolsPage() {
  const user = await getCurrentUser();
  return (
    <Suspense>
      <BoxTools canEdit={user?.role === "ADMIN"} />
    </Suspense>
  );
}
