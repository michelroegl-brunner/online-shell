import { redirect } from "next/navigation";

import { AppHeader } from "~/components/app-header";
import { homeFor, isStaff } from "~/lib/roles";
import { getCurrentUser } from "~/server/auth/current-user";

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
  // proxy.ts already guards /admin by the JWT role; this re-checks the live
  // DB role.
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");
  if (!isStaff(user.role)) redirect(homeFor(user.role));

  return (
    <>
      <AppHeader user={user} home="/admin" nav={NAV} />
      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </>
  );
}
