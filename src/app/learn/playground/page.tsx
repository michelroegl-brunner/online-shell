import { redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { ShellTerminal } from "~/components/terminal/shell-terminal";
import { getCurrentUser } from "~/server/auth/current-user";

export default async function PlaygroundPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        user={user}
        home="/learn"
        nav={[{ href: "/learn/playground", label: "Playground" }]}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold">Playground</h1>
          <p className="text-muted-foreground text-sm">
            Your own Bash shell. Files in your home folder are kept between
            sessions.
          </p>
        </div>
        <ShellTerminal className="min-h-[24rem] flex-1" />
      </main>
    </div>
  );
}
