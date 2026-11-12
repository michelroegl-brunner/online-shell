import "server-only";

import { env } from "~/env";

/**
 * App-only Microsoft Graph client (client-credentials flow).
 *
 * Needs APPLICATION permissions on the app registration (admin consent):
 *   - Group.Read.All        (search / read groups)
 *   - GroupMember.Read.All  (read group members)
 *   - User.ReadBasic.All    (names + emails of those members; without it
 *                            Graph returns members with only their id)
 */

export const graphEnabled = Boolean(
  env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
);

const GRAPH = "https://graph.microsoft.com/v1.0";

let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (!graphEnabled) throw new Error("Graph is not configured");
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(
    `https://login.microsoftonline.com/${env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.AUTH_MICROSOFT_ENTRA_ID_ID!,
        client_secret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
        scope: "https://graph.microsoft.com/.default",
      }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(
      `Graph token request failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cached.token;
}

async function graphGet<T>(url: string, headers: Record<string, string> = {}) {
  const token = await getToken();
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    headers: { Authorization: `Bearer ${token}`, ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Graph GET ${url} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

type Page<T> = { value: T[]; "@odata.nextLink"?: string };

export type GraphGroup = {
  id: string;
  displayName: string;
  description: string | null;
  mail: string | null;
};

export type GraphUser = {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
};

/** Search groups by display name (max 25). */
export async function searchGroups(q: string): Promise<GraphGroup[]> {
  // $search values must be quoted; strip quotes the user typed.
  const term = q.replace(/["\\]/g, "").trim();
  const params = new URLSearchParams({
    $select: "id,displayName,description,mail",
    $top: "25",
    $orderby: "displayName",
  });
  if (term) params.set("$search", `"displayName:${term}"`);
  const page = await graphGet<Page<GraphGroup>>(`/groups?${params}`, {
    ConsistencyLevel: "eventual",
  });
  return page.value;
}

export function getGroup(id: string): Promise<GraphGroup> {
  return graphGet<GraphGroup>(
    `/groups/${encodeURIComponent(id)}?$select=id,displayName,description,mail`,
  );
}

/** All (transitive) user members of a group, following paging. */
export async function listGroupMembers(id: string): Promise<GraphUser[]> {
  const users: GraphUser[] = [];
  let url: string | undefined =
    `/groups/${encodeURIComponent(id)}/transitiveMembers/microsoft.graph.user` +
    `?$select=id,displayName,mail,userPrincipalName&$top=999`;
  while (url) {
    const page: Page<GraphUser> = await graphGet<Page<GraphUser>>(url);
    users.push(...page.value);
    url = page["@odata.nextLink"];
  }
  return users;
}
