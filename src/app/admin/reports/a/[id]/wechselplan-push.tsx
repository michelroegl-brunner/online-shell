"use client";

import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { formatDateTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { type GradeScale, gradeFor } from "./grades";

type Data = RouterOutputs["report"]["assignment"];
type Targets = RouterOutputs["wechselplan"]["gradeTargets"];
type Result = RouterOutputs["wechselplan"]["pushGrades"]["results"][number];

const FIELDS = [
  ["praktischeArbeit1", "Praktische Arbeit 1"],
  ["praktischeArbeit2", "Praktische Arbeit 2"],
  ["mitarbeit1", "Mitarbeit 1"],
  ["mitarbeit2", "Mitarbeit 2"],
  ["wiederholung1", "Wiederholung 1"],
  ["wiederholung2", "Wiederholung 2"],
  ["bericht1", "Bericht 1"],
  ["bericht2", "Bericht 2"],
] as const;
type Field = (typeof FIELDS)[number][0];
const FIELD_LABEL = Object.fromEntries(FIELDS) as Record<string, string>;

const selectCls =
  "border-input bg-background h-9 rounded-md border px-2 text-sm disabled:opacity-60";

const STATUS: Record<Result["status"], string> = {
  written: "written",
  unchanged: "already there",
  exists: "kept existing mark",
  invalid: "invalid",
  unknown_student: "not in the class in Wechselplan",
  no_school_year: "date outside the school year",
  no_group: "no group on that day",
  not_teaching_day: "not your lesson for their group",
};

/** "2026-11-09" + "AM" → "09.11. AM" */
const slotLabel = (d: { date: string; period: string }) => {
  const [, m, day] = d.date.split("-");
  return `${day}.${m}. ${d.period}`;
};
const slotKey = (d: { date: string; period: string }) =>
  `${d.date}|${d.period}`;

/** Latest teaching day up to today, else the first one. */
function defaultSlot(days: { date: string; period: string }[]) {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const past = days.filter((d) => d.date <= today);
  const pick = past[past.length - 1] ?? days[0];
  return pick ? slotKey(pick) : "";
}

/** Button + dialog: send this assignment's grades to Wechselplan's Noten grid. */
export function WechselplanPushButton({
  data,
  scale,
}: {
  data: Data;
  scale: GradeScale;
}) {
  const status = api.wechselplan.status.useQuery();
  const [open, setOpen] = useState(false);
  if (!status.data?.enabled) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        title="Send the grades to the Noten grid in Wechselplan"
      >
        <ArrowRightLeft /> Wechselplan
      </Button>
      {open && (
        <PushDialog data={data} scale={scale} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function PushDialog({
  data,
  scale,
  onClose,
}: {
  data: Data;
  scale: GradeScale;
  onClose: () => void;
}) {
  const targets = api.wechselplan.gradeTargets.useQuery(
    { assignmentId: data.assignment.id },
    { retry: false, refetchOnWindowFocus: false },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Send grades to Wechselplan</DialogTitle>
          <DialogDescription>
            Each student’s grade goes into your Noten grid in Wechselplan, on
            the lesson you pick for their group (groups have you on different
            dates). Grades use the current grade scale (≥{" "}
            {scale.thresholds.join(" / ")} %); you can change single grades
            below.
          </DialogDescription>
        </DialogHeader>
        {targets.isLoading && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading your lessons
            from Wechselplan…
          </p>
        )}
        {targets.error && (
          <p className="text-destructive text-sm">{targets.error.message}</p>
        )}
        {targets.data && (
          <PushForm
            data={data}
            scale={scale}
            targets={targets.data}
            onPushed={() => void targets.refetch()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PushForm({
  data,
  scale,
  targets,
  onPushed,
}: {
  data: Data;
  scale: GradeScale;
  targets: Targets;
  onPushed: () => void;
}) {
  const [field, setField] = useState<Field>("praktischeArbeit1");
  const [overwrite, setOverwrite] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const day = targets.days[dayIdx];
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<Record<string, number | null>>({});
  const [results, setResults] = useState<Map<string, Result>>(new Map());

  const slotOf = (groupId: number) => {
    const g = day?.groups.find((x) => x.groupId === groupId);
    return slots[`${dayIdx}:${groupId}`] ?? defaultSlot(g?.teachingDays ?? []);
  };

  const groupOf = useMemo(() => {
    const m = new Map<string, NonNullable<typeof day>["groups"][number]>();
    for (const g of day?.groups ?? []) for (const u of g.userIds) m.set(u, g);
    return m;
  }, [day]);

  const rows = data.rows
    .filter((r) => r.targeted)
    .map((r) => {
      const worked = r.cells.some(Boolean);
      const computed = worked ? gradeFor(r.total, data.maxPoints, scale) : null;
      const grade = r.student.id in grades ? grades[r.student.id]! : computed;
      return { r, grade, group: groupOf.get(r.student.id) ?? null };
    });

  const entries = rows.flatMap(({ r, grade, group }) => {
    if (grade == null || !group) return [];
    const slot = slotOf(group.groupId);
    if (!slot) return [];
    const [date, period] = slot.split("|") as [string, "AM" | "PM"];
    return [{ userId: r.student.id, date, period, grade }];
  });

  const push = api.wechselplan.pushGrades.useMutation({
    onSuccess: (res) => {
      setResults(
        new Map(res.results.flatMap((x) => (x.userId ? [[x.userId, x]] : []))),
      );
      const kept = res.results.filter((x) => x.status === "exists").length;
      const failed = res.results.filter(
        (x) => !["written", "unchanged", "exists"].includes(x.status),
      ).length;
      toast.success(
        `${res.written} grade${res.written === 1 ? "" : "s"} written` +
          (kept ? `, ${kept} existing kept` : "") +
          (failed ? `, ${failed} not possible` : ""),
      );
      onPushed();
    },
    onError: (e) => toast.error(e.message),
  });

  if (targets.days.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Wechselplan has no lessons of yours with {targets.className}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wp-field">Column</Label>
          <select
            id="wp-field"
            className={selectCls}
            value={field}
            onChange={(e) => setField(e.target.value as Field)}
          >
            {FIELDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {targets.days.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wp-day">Weekday</Label>
            <select
              id="wp-day"
              className={selectCls}
              value={dayIdx}
              onChange={(e) => setDayIdx(Number(e.target.value))}
            >
              {targets.days.map((d, i) => (
                <option key={`${d.weekday}-${d.planClassName}`} value={i}>
                  {d.label}
                  {d.planClassName !== targets.className
                    ? ` (${d.planClassName})`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <label className="flex h-9 items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          Overwrite existing marks
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        {day?.groups.map((g) => (
          <div key={g.groupId} className="flex flex-col gap-1.5">
            <Label htmlFor={`wp-g-${g.groupId}`}>
              {g.name} ({g.userIds.length})
            </Label>
            {g.teachingDays.length === 0 ? (
              <span className="text-muted-foreground h-9 text-sm leading-9">
                no lessons with you
              </span>
            ) : (
              <select
                id={`wp-g-${g.groupId}`}
                className={selectCls}
                value={slotOf(g.groupId)}
                onChange={(e) =>
                  setSlots((s) => ({
                    ...s,
                    [`${dayIdx}:${g.groupId}`]: e.target.value,
                  }))
                }
              >
                {g.teachingDays.map((d) => (
                  <option key={slotKey(d)} value={slotKey(d)}>
                    {slotLabel(d)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="px-3 py-2 font-medium">Group</th>
              <th className="px-3 py-2 text-right font-medium">Points</th>
              <th className="px-3 py-2 font-medium">Grade</th>
              <th className="px-3 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, grade, group }) => {
              const res = results.get(r.student.id);
              return (
                <tr key={r.student.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{r.student.name}</td>
                  <td className="text-muted-foreground px-3 py-1.5">
                    {group ? (
                      <>
                        {group.name}
                        {slotOf(group.groupId) && (
                          <span className="ml-1 text-xs">
                            ·{" "}
                            {slotLabel({
                              date: slotOf(group.groupId).split("|")[0]!,
                              period: slotOf(group.groupId).split("|")[1]!,
                            })}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        no group in Wechselplan
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.cells.some(Boolean) ? (
                      <>
                        {r.total}/{data.maxPoints}
                      </>
                    ) : (
                      <span className="text-muted-foreground">not started</span>
                    )}
                  </td>
                  <td className="px-3 py-1">
                    <select
                      className={cn(selectCls, "h-8")}
                      aria-label={`Grade for ${r.student.name}`}
                      value={grade ?? ""}
                      onChange={(e) =>
                        setGrades((g) => ({
                          ...g,
                          [r.student.id]: e.target.value
                            ? Number(e.target.value)
                            : null,
                        }))
                      }
                    >
                      <option value="">— skip</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-xs",
                      res?.status === "written" &&
                        "text-emerald-600 dark:text-emerald-400",
                      res &&
                        !["written", "unchanged"].includes(res.status) &&
                        "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {res &&
                      (res.status === "exists"
                        ? `has ${res.existing} (kept)`
                        : STATUS[res.status])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {targets.notInWechselplan.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {targets.notInWechselplan.length} student
          {targets.notInWechselplan.length === 1 ? " is" : "s are"} in this
          class here but not in Wechselplan; they are skipped.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={push.isPending || entries.length === 0}
          onClick={() =>
            push.mutate({
              assignmentId: data.assignment.id,
              field,
              overwrite,
              entries,
            })
          }
        >
          {push.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ArrowRightLeft />
          )}
          Send {entries.length} grade{entries.length === 1 ? "" : "s"} to{" "}
          {FIELD_LABEL[field]}
        </Button>
        {targets.lastPushes.length > 0 && (
          <span className="text-muted-foreground text-xs">
            Last sent {formatDateTime(targets.lastPushes[0]!.createdAt)} by{" "}
            {targets.lastPushes[0]!.user.name} (
            {FIELD_LABEL[targets.lastPushes[0]!.field] ??
              targets.lastPushes[0]!.field}
            , {targets.lastPushes[0]!.written}/{targets.lastPushes[0]!.sent}{" "}
            written)
          </span>
        )}
      </div>
    </div>
  );
}
