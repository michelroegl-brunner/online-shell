import { LogOut, TerminalSquare } from "lucide-react";
import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { signOut } from "~/server/auth";

export function AppHeader({
  user,
  home,
  nav = [],
}: {
  user: { name?: string | null; role: string };
  home: string;
  nav?: { href: string; label: string }[];
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href={home} className="flex items-center gap-2 font-semibold">
          <TerminalSquare className="text-primary size-5" />
          Online Shell
        </Link>
        <nav className="text-muted-foreground flex gap-4 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden sm:inline">{user.name}</span>
          <Badge variant="secondary">{user.role.toLowerCase()}</Badge>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/auth/signin" });
            }}
          >
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              aria-label="Sign out"
            >
              <LogOut />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
