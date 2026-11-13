import "server-only";

import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { z } from "zod";

import { env } from "~/env";
import { authConfigEdge } from "./config.edge";
import { type EntraProfile, fetchMyGroupIds, roleFromEntra } from "./entra";
import { syncClassMemberships, upsertUser } from "./provision";

export const entraEnabled = Boolean(
  env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
);

export const devLoginEnabled =
  env.AUTH_DEV_LOGIN && env.NODE_ENV !== "production";

const devLoginInput = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "TEACHER", "STUDENT"]),
});

const providers: NextAuthConfig["providers"] = [];

if (entraEnabled) {
  providers.push(
    MicrosoftEntraID({
      clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: `https://login.microsoftonline.com/${env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read GroupMember.Read.All",
        },
      },
      // Skip the default profile-photo fetch: it would put a base64 image
      // into the JWT cookie.
      profile: (p: EntraProfile) => ({
        id: p.oid,
        name: p.name ?? p.preferred_username ?? p.oid,
        email: p.email ?? p.preferred_username ?? null,
      }),
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev login",
      credentials: { email: {}, role: {} },
      authorize: async (raw) => {
        const parsed = devLoginInput.safeParse(raw);
        if (!parsed.success) return null;
        const { email, role } = parsed.data;
        const name = email.split("@")[0] ?? email;
        const user = await upsertUser({
          entraOid: `dev:${email.toLowerCase()}`,
          email,
          name,
          role,
        });
        return { id: user.id, email, name, role: user.role };
      },
    }),
  );
}

export const authConfig = {
  ...authConfigEdge,
  providers,
  callbacks: {
    ...authConfigEdge.callbacks,
    // `account` is only set on sign-in; afterwards the token is passed
    // through unchanged. Role and classes are refreshed on every login.
    jwt: async ({ token, user, account, profile }) => {
      if (account?.provider === "microsoft-entra-id" && profile) {
        const p = profile as unknown as EntraProfile;
        const groupIds = account.access_token
          ? await fetchMyGroupIds(account.access_token)
          : null;
        const adminGroups = env.ENTRA_ADMIN_GROUP_IDS;
        // Fail closed: if Graph failed, only the ID-token app roles count.
        // Never derive ADMIN from the stored role.
        const inAdminGroup =
          groupIds?.some((id) => adminGroups.includes(id.toLowerCase())) ??
          false;
        const dbUser = await upsertUser({
          entraOid: p.oid,
          email: p.email ?? p.preferred_username ?? `${p.oid}@unknown`,
          name: p.name ?? p.preferred_username ?? p.oid,
          role: roleFromEntra(p.roles, inAdminGroup),
        });
        token.id = dbUser.id;
        token.role = dbUser.role;

        if (groupIds) await syncClassMemberships(dbUser.id, groupIds);
      } else if (account?.provider === "dev-login" && user) {
        const u = user as { id: string; role: string };
        token.id = u.id;
        token.role = u.role;
      }
      return token;
    },
  },
} satisfies NextAuthConfig;
