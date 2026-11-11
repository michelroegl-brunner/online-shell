import { redirect } from "next/navigation";

import { homeFor } from "~/lib/roles";
import { auth } from "~/server/auth";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/auth/signin");
  redirect(homeFor(session.user.role));
}
