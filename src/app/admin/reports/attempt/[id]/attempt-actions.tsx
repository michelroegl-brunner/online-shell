"use client";

import {
  Clock,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/trpc/react";

export type AttemptActionsProps = {
  attemptId: string;
  assignmentId: string;
  studentId: string;
  maxPoints: number;
  computedScore: number | null;
  scoreOverride: number | null;
  feedback: string | null;
  maxChecks: number | null;
  extraChecks: number;
  extraMinutes: number;
  hasDueDate: boolean;
  exam: boolean;
  submittedAt: Date | null;
};

/** Teacher actions for one attempt (right column of the attempt page). */
export function AttemptActions(p: AttemptActionsProps) {
  const router = useRouter();
  const done = (msg: string) => {
    toast.success(msg);
    router.refresh();
  };
  const fail = (e: { message: string }) => toast.error(e.message);

  const setScore = api.manage.setScore.useMutation({ onError: fail });
  const setFeedback = api.manage.setFeedback.useMutation({ onError: fail });
  const setExtraChecks = api.manage.setExtraChecks.useMutation({
    onError: fail,
  });
  const setExtension = api.manage.setExtension.useMutation({ onError: fail });
  const reopen = api.manage.reopenSubmission.useMutation({ onError: fail });
  const reset = api.manage.resetAttempt.useMutation({ onError: fail });

  const [score, setScoreInput] = useState(
    p.scoreOverride === null ? "" : String(p.scoreOverride),
  );
  const [text, setText] = useState(p.feedback ?? "");
  const [minutes, setMinutes] = useState(String(p.extraMinutes || ""));

  async function saveScore() {
    const v = score.trim();
    const n = v === "" ? null : Number(v);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > p.maxPoints)) {
      return toast.error(`Enter 0–${p.maxPoints}, or leave empty.`);
    }
    await setScore.mutateAsync({ attemptId: p.attemptId, score: n });
    done(n === null ? "Back to the computed points" : "Points set");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Teacher actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="score">
            <Pencil className="size-3.5" /> Points (manual)
          </Label>
          <div className="flex gap-2">
            <Input
              id="score"
              type="number"
              min={0}
              max={p.maxPoints}
              placeholder={`computed: ${p.computedScore ?? 0}`}
              value={score}
              onChange={(e) => setScoreInput(e.target.value)}
              className="w-32"
            />
            <span className="text-muted-foreground self-center">
              / {p.maxPoints}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={setScore.isPending}
              onClick={() => void saveScore()}
            >
              {setScore.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
          <span className="text-muted-foreground text-xs">
            {p.scoreOverride !== null
              ? "Overrides the check result. Empty + Save = back to computed."
              : "Empty = points from the checks."}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feedback">
            <MessageSquare className="size-3.5" /> Feedback for the student
          </Label>
          <Textarea
            id="feedback"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Shown on the exercise page."
          />
          <div className="flex justify-end gap-2">
            {p.feedback && (
              <Button
                size="sm"
                variant="ghost"
                disabled={setFeedback.isPending}
                onClick={() =>
                  void setFeedback
                    .mutateAsync({ attemptId: p.attemptId, text: "" })
                    .then(() => {
                      setText("");
                      done("Feedback removed");
                    })
                }
              >
                Remove
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={
                setFeedback.isPending || text.trim() === (p.feedback ?? "")
              }
              onClick={() =>
                void setFeedback
                  .mutateAsync({ attemptId: p.attemptId, text })
                  .then(() => done("Feedback saved"))
              }
            >
              Save feedback
            </Button>
          </div>
        </div>

        {p.maxChecks !== null && (
          <div className="flex flex-col gap-1.5">
            <Label>
              <Plus className="size-3.5" /> Extra checks per step
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                Limit {p.maxChecks}
                {p.extraChecks > 0 && ` + ${p.extraChecks}`} ={" "}
                {p.maxChecks + p.extraChecks}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={setExtraChecks.isPending}
                onClick={() =>
                  void setExtraChecks
                    .mutateAsync({
                      attemptId: p.attemptId,
                      extraChecks: p.extraChecks + 3,
                    })
                    .then(() => done("3 more checks granted"))
                }
              >
                +3 checks
              </Button>
              {p.extraChecks > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={setExtraChecks.isPending}
                  onClick={() =>
                    void setExtraChecks
                      .mutateAsync({ attemptId: p.attemptId, extraChecks: 0 })
                      .then(() => done("Extra checks removed"))
                  }
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        )}

        {p.hasDueDate && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="extra-min">
              <Clock className="size-3.5" /> Extra time (whole assignment)
            </Label>
            <div className="flex gap-2">
              <Input
                id="extra-min"
                type="number"
                min={0}
                placeholder="0"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="w-24"
              />
              <span className="text-muted-foreground self-center">min</span>
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={setExtension.isPending}
                onClick={() => {
                  const n = Number(minutes || 0);
                  if (!Number.isInteger(n) || n < 0) {
                    return toast.error("Enter whole minutes.");
                  }
                  void setExtension
                    .mutateAsync({
                      assignmentId: p.assignmentId,
                      userId: p.studentId,
                      extraMinutes: n,
                    })
                    .then(() =>
                      done(
                        n ? `+${n} min for this student` : "Extension removed",
                      ),
                    );
                }}
              >
                Save
              </Button>
            </div>
          </div>
        )}

        {p.exam && p.submittedAt && (
          <Button
            variant="secondary"
            disabled={reopen.isPending}
            onClick={() =>
              void reopen
                .mutateAsync({
                  assignmentId: p.assignmentId,
                  userId: p.studentId,
                })
                .then(() => done("Exam reopened for this student"))
            }
          >
            <Unlock /> Reopen handed-in exam
          </Button>
        )}

        <div className="border-t pt-4">
          <Button
            variant="ghost"
            className="text-red-400 hover:text-red-300"
            disabled={reset.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  "Reset this attempt? Progress, points, command history and events are deleted; the student starts over with a fresh folder.",
                )
              ) {
                return;
              }
              void reset.mutateAsync({ attemptId: p.attemptId }).then(() => {
                toast.success("Attempt reset");
                router.push(`/admin/reports/a/${p.assignmentId}`);
              });
            }}
          >
            {reset.isPending ? (
              <RotateCcw className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            Reset attempt
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
