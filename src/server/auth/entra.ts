import "server-only";

import type { Role } from "../../../generated/prisma";

/** Raw ID-token claims we use from Entra (v2.0 endpoint). */
export type EntraProfile = {
  oid: string;
  tid: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  /** App Role values assigned to the user (Enterprise app → Users and groups). */
  roles?: string[];
};

/**
 * App Role values defined in the Entra app registration.
 * Highest wins; no role = STUDENT.
 */
export function roleFromEntra(roles: string[] | undefined): Role {
  const r = new Set((roles ?? []).map((x) => x.toLowerCase()));
  if (r.has("admin")) return "ADMIN";
  if (r.has("teacher")) return "TEACHER";
  return "STUDENT";
}

type GraphPage = { value: { id: string }[]; "@odata.nextLink"?: string };

/**
 * All group ids the signed-in user is a (transitive) member of, via Graph.
 * Needs the delegated `GroupMember.Read.All` scope (admin consent).
 * Returns null on failure so callers keep the existing memberships.
 */
export async function fetchMyGroupIds(
  accessToken: string,
): Promise<string[] | null> {
  const ids: string[] = [];
  let url: string | undefined =
    "https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=id&$top=999";
  try {
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        console.warn(`[auth] Graph memberOf failed: ${res.status}`);
        return null;
      }
      const page = (await res.json()) as GraphPage;
      ids.push(...page.value.map((g) => g.id));
      url = page["@odata.nextLink"];
    }
    return ids;
  } catch (err) {
    console.warn("[auth] Graph memberOf error", err);
    return null;
  }
}
