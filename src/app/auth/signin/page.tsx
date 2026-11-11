import { TerminalSquare } from "lucide-react";
import { redirect } from "next/navigation";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { env } from "~/env";
import { auth, signIn } from "~/server/auth";
import { devLoginEnabled, entraEnabled } from "~/server/auth/config";

/**
 * Only allow redirects to our own origin. Uses the URL parser (not prefix
 * checks), so `//evil.com`, `/\evil.com` and absolute URLs are rejected.
 */
function safeCallback(raw: string | string[] | undefined) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return "/";
  try {
    const own = new URL(env.APP_URL);
    const u = new URL(v, own);
    if (u.origin !== own.origin) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallback(params.callbackUrl);
  const error = params.error;

  const session = await auth();
  if (session?.user) redirect(callbackUrl);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="justify-items-center text-center">
          <TerminalSquare className="text-primary size-10" />
          <CardTitle className="text-xl">Online Shell</CardTitle>
          <CardDescription>
            Sign in with your school Microsoft account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error && (
            <p className="text-destructive text-sm">
              Sign-in failed. Please try again.
            </p>
          )}

          {entraEnabled ? (
            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
              }}
            >
              <Button type="submit" className="w-full">
                Sign in with Microsoft
              </Button>
            </form>
          ) : (
            <p className="text-muted-foreground text-sm">
              Microsoft sign-in is not configured yet (set the
              <code className="font-mono"> AUTH_MICROSOFT_ENTRA_ID_*</code>{" "}
              variables).
            </p>
          )}

          {devLoginEnabled && (
            <form
              className="flex flex-col gap-3 border-t pt-6"
              action={async (formData) => {
                "use server";
                await signIn("dev-login", {
                  email: formData.get("email"),
                  role: formData.get("role"),
                  redirectTo: callbackUrl,
                });
              }}
            >
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Dev login
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue="student@dev.local"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="submit"
                  name="role"
                  value="STUDENT"
                  variant="secondary"
                >
                  Student
                </Button>
                <Button
                  type="submit"
                  name="role"
                  value="TEACHER"
                  variant="secondary"
                >
                  Teacher
                </Button>
                <Button
                  type="submit"
                  name="role"
                  value="ADMIN"
                  variant="secondary"
                >
                  Admin
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
