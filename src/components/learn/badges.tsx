import {
  BookOpen,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Lock,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { formatDateTime, isWithin, relativeTime } from "~/lib/format";
import { cn } from "~/lib/utils";

type WindowState = "upcoming" | "open" | "closed";
type AttemptStatus = "IN_PROGRESS" | "PASSED" | "FAILED" | "ABANDONED";

/** Shows when an assignment opens / is due / closed. */
export function WindowBadge({
  state,
  opensAt,
  dueAt,
}: {
  state: WindowState;
  opensAt?: Date | null;
  dueAt?: Date | null;
}) {
  if (state === "upcoming") {
    return (
      <Badge variant="outline" title={formatDateTime(opensAt)}>
        <Clock /> opens {opensAt ? relativeTime(opensAt) : "later"}
      </Badge>
    );
  }
  if (state === "closed") {
    return (
      <Badge variant="secondary" title={formatDateTime(dueAt)}>
        <Lock /> closed
      </Badge>
    );
  }
  if (dueAt) {
    const soon = isWithin(dueAt, 24 * 3_600_000);
    return (
      <Badge
        variant="outline"
        title={formatDateTime(dueAt)}
        className={cn(soon && "border-amber-500/50 text-amber-400")}
      >
        <Clock /> due {relativeTime(dueAt)}
      </Badge>
    );
  }
  return <Badge variant="outline">open</Badge>;
}

/** Icon for my status on one exercise. */
export function AttemptIcon({
  status,
  className,
}: {
  status: AttemptStatus | null;
  className?: string;
}) {
  if (status === "PASSED") {
    return (
      <CheckCircle2
        className={cn("text-primary size-5", className)}
        aria-label="Solved"
      />
    );
  }
  if (status) {
    return (
      <CircleDot
        className={cn("size-5 text-amber-400", className)}
        aria-label="Started"
      />
    );
  }
  return (
    <Circle
      className={cn("text-muted-foreground size-5", className)}
      aria-label="Not started"
    />
  );
}

/** Marks a lesson (guided, ungraded walkthrough) in lists. */
export function LessonBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-sky-400/40 text-sky-300", className)}
      title="Guided lesson: no points, checks itself as you go"
    >
      <BookOpen /> lesson
    </Badge>
  );
}
