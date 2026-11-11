import type { DefaultSession, NextAuthConfig } from "next-auth";

import type { AppRole } from "~/lib/roles";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      role: AppRole;
    } & DefaultSession["user"];
  }
}

/**
 * Edge-safe part of the auth config: no providers, no DB. Used by
 * `src/proxy.ts` to read the JWT. The full config (`config.ts`) adds the
 * providers and the DB-backed `jwt` callback on top of this.
 */
export const authConfigEdge = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 10 },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },
  providers: [],
  callbacks: {
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.id as string,
        role: token.role as AppRole,
      },
    }),
  },
} satisfies NextAuthConfig;
