import { Users } from "lucide-react";

import { AppHeader } from "~/components/app-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/server";

export default async function LearnPage() {
  const me = await api.me.get();
  const classes = me.memberships.map((m) => m.class);

  return (
    <>
      <AppHeader user={me} home="/learn" />
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="mb-1 text-2xl font-semibold">
          Hi {me.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground mb-6">Your classes</p>

        {classes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No classes yet</CardTitle>
              <CardDescription>
                You are not in any class that uses Online Shell. Your teacher
                has to add your class first; then sign in again.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c) => (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="text-muted-foreground size-4" />
                    {c.name}
                  </CardTitle>
                  <CardDescription>No open assignments</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
