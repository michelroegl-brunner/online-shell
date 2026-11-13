import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { LEARN_NAV } from "~/lib/nav";
import { ShellTerminal } from "~/components/terminal/shell-terminal";
import { cn } from "~/lib/utils";
import { getCurrentUser } from "~/server/auth/current-user";
import { api } from "~/trpc/server";

const SHELLS = [
  { key: "bash", value: "BASH", label: "Bash" },
  { key: "pwsh", value: "PWSH", label: "PowerShell" },
] as const;

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ shell?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");
  const { shell: shellParam } = await searchParams;
  const shell = SHELLS.find((s) => s.key === shellParam) ?? SHELLS[0];
  // An exam is running: the playground is locked (same box).
  const exam = await api.learn.examLock();

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader user={user} home="/learn" nav={LEARN_NAV} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Playground</h1>
            <p className="text-muted-foreground text-sm">
              Your own {shell.label} shell. Files in your home folder are kept
              between sessions.
            </p>
          </div>
          <div className="bg-muted inline-flex rounded-md p-0.5 text-sm">
            {SHELLS.map((s) => (
              <Link
                key={s.key}
                href={`/learn/playground?shell=${s.key}`}
                className={cn(
                  "rounded px-3 py-1",
                  s.key === shell.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
        {exam ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border p-8 text-center">
            <p className="font-medium">
              The playground is locked while your exam &ldquo;{exam.title}
              &rdquo; is running.
            </p>
            <Link
              href={`/learn/a/${exam.id}`}
              className="text-primary text-sm underline"
            >
              Back to the exam
            </Link>
          </div>
        ) : (
          /* Remount on switch: the runner swaps the box to the other image. */
          <ShellTerminal
            key={shell.key}
            shell={shell.value}
            className="min-h-[24rem] flex-1"
          />
        )}
      </main>
    </div>
  );
}
