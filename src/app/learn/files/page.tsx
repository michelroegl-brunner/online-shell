import { redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { FileBrowser } from "~/components/files/file-browser";
import { LEARN_NAV } from "~/lib/nav";
import { getCurrentUser } from "~/server/auth/current-user";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");
  const { path } = await searchParams;

  return (
    <>
      <AppHeader user={user} home="/learn" nav={LEARN_NAV} />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold">Your files</h1>
          <p className="text-muted-foreground text-sm">
            Your home folder, the same one you see in the shell. Exercises are
            in <code className="font-mono text-xs">~/exercises</code>.
          </p>
        </div>
        <FileBrowser initialPath={path ?? ""} />
      </main>
    </>
  );
}
