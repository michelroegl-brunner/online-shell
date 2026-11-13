import { AlertTriangle, BarChart3 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/server";

const pct = (x: number | null) =>
  x === null ? "—" : `${Math.round(x * 100)}%`;
const mins = (m: number | null) =>
  m === null ? "—" : m < 1 ? "<1 min" : `${Math.round(m)} min`;

/**
 * How students do on this exercise across every assignment that used it
 * (students only, aggregates only). Flags steps that look too hard,
 * unclear or slow.
 */
export async function ExerciseStats({ exerciseId }: { exerciseId: string }) {
  const s = await api.insights.exerciseStats({ exerciseId });
  const flagged = s.steps.filter((st) => st.flags.length > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="size-4" /> How students do
        </CardTitle>
        <CardDescription>
          {s.attempts === 0
            ? "No student has worked on this exercise yet."
            : `${s.attempts} attempts in ${s.assignments} assignment${s.assignments === 1 ? "" : "s"} · ${pct(s.attempts ? s.solved / s.attempts : null)} solved · median ${mins(s.medianMinutes)} to solve · ${s.avgScorePct === null ? "—" : `${Math.round(s.avgScorePct * 100)}%`} of the points on average · ${s.avgResets?.toFixed(1) ?? "—"} resets`}
          {flagged > 0 &&
            ` · ${flagged} step${flagged === 1 ? "" : "s"} worth a look`}
        </CardDescription>
      </CardHeader>
      {s.attempts > 0 && (
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="px-6 py-2 font-medium">Step</th>
                <th className="px-2 py-2 text-right font-medium">Started</th>
                <th className="px-2 py-2 text-right font-medium">Solved</th>
                <th className="px-2 py-2 text-right font-medium">
                  Checks to solve
                </th>
                <th className="px-2 py-2 text-right font-medium">Hints</th>
                <th className="px-2 py-2 text-right font-medium">
                  Median time
                </th>
                <th className="px-6 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.steps.map((st, i) => (
                <tr
                  key={st.id}
                  className={cn(
                    "border-b last:border-0",
                    st.flags.length > 0 && "bg-amber-500/5",
                  )}
                >
                  <td className="px-6 py-2">
                    {i + 1}. {st.title}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {st.started}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {pct(st.passRate)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {st.avgChecks?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {st.avgHints === null
                      ? "—"
                      : `${st.avgHints.toFixed(1)}/${st.hintCount}`}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {mins(st.medianMinutes)}
                  </td>
                  <td className="px-6 py-2 text-xs">
                    {st.flags.length > 0 ? (
                      <span className="inline-flex items-start gap-1 text-amber-400">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        {st.flags.join(" · ")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      )}
    </Card>
  );
}
