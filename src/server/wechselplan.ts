import "server-only";

import { env } from "~/env";

/**
 * Server-to-server client for Wechselplan's Online-Shell integration
 * (Wechselplan: docs/API/integrations/online-shell/README.md).
 *
 * Both apps key people and classes on the same Entra ids: Wechselplan's
 * `Student.externalId` is our `User.entraOid`, its `Class.externalId` our
 * `Class.entraGroupId`. Calls carry a shared secret and name the teacher they
 * act for; Wechselplan only returns/accepts what that teacher teaches.
 */

export const wechselplanEnabled = Boolean(
  env.WECHSELPLAN_URL && env.WECHSELPLAN_API_SECRET,
);

export type WpTeacherRef = { oid: string | null; email: string };

export type WpStudentRef = { oid: string | null; email: string | null };

export type WpClass = {
  id: number;
  name: string;
  /** Entra group id (= our Class.entraGroupId); null if not from Entra. */
  externalId: string | null;
  students: (WpStudentRef & { firstName: string; lastName: string })[];
  days: {
    /** 0 = Sunday, 1 = Monday, … */
    weekday: number;
    planClassId: number;
    planClassName: string;
    groups: {
      groupId: number;
      students: WpStudentRef[];
      teachingDays: { date: string; period: "AM" | "PM" }[];
    }[];
  }[];
};

export type WpClassesResponse = {
  teacher: { id: number; firstName: string; lastName: string };
  schoolYear: { id: number; label: string } | null;
  classes: WpClass[];
};

export const WP_GRADE_FIELDS = [
  "praktischeArbeit1",
  "praktischeArbeit2",
  "mitarbeit1",
  "mitarbeit2",
  "wiederholung1",
  "wiederholung2",
  "bericht1",
  "bericht2",
] as const;
export type WpGradeField = (typeof WP_GRADE_FIELDS)[number];

export type WpGradeStatus =
  | "written"
  | "unchanged"
  | "exists"
  | "invalid"
  | "unknown_student"
  | "no_school_year"
  | "no_group"
  | "not_teaching_day";

export type WpGradeResult = {
  studentOid: string;
  status: WpGradeStatus;
  existing?: number | null;
};

export class WechselplanError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WechselplanError";
  }
}

/** Entra oid for Wechselplan; dev-login users ("dev:…") have none. */
export const teacherRef = (u: {
  entraOid: string;
  email: string;
}): WpTeacherRef => ({
  oid: u.entraOid.startsWith("dev:") ? null : u.entraOid,
  email: u.email,
});

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!wechselplanEnabled) {
    throw new WechselplanError("Wechselplan is not configured.", 503);
  }
  let res: Response;
  try {
    res = await fetch(`${env.WECHSELPLAN_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-online-shell-secret": env.WECHSELPLAN_API_SECRET!,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.error("[wechselplan] request failed", e);
    throw new WechselplanError("Wechselplan is not reachable.", 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `Wechselplan answered ${res.status}.`;
    try {
      const err = (JSON.parse(text) as { error?: string }).error;
      if (err) message = `Wechselplan: ${err}`;
    } catch {
      /* not JSON */
    }
    throw new WechselplanError(message, res.status);
  }
  return (await res.json()) as T;
}

export function fetchTeacherClasses(teacher: WpTeacherRef) {
  return post<WpClassesResponse>("/api/integrations/online-shell/classes", {
    teacher,
  });
}

export function pushGrades(params: {
  teacher: WpTeacherRef;
  classExternalId: string;
  field: WpGradeField;
  overwrite: boolean;
  entries: {
    studentOid: string;
    date: string;
    period: "AM" | "PM";
    grade: number;
  }[];
}) {
  return post<{ results: WpGradeResult[] }>(
    "/api/integrations/online-shell/grades",
    params,
  );
}
