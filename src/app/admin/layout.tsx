import { redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { homeFor, isStaff } from "~/lib/roles";
import { auth } from "~/server/auth";

const NAV = [
  { href: "/admin/exercises", label: "Exercises" },
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/reports", label: "Reports" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // proxy.ts already guards /admin; this is the server-side backstop.
  const session = await auth();
  if (!session?.user) redirect("/auth/signin");
  if (!isStaff(session.user.role)) redirect(homeFor(session.user.role));

  return (
    <>
      <AppHeader user={session.user} home="/admin" nav={NAV} />
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </>
  );
}
