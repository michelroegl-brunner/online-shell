"use client";

import { Lock, Maximize, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

const MIN_BLUR_MS = 1500;

const isFullscreen = () =>
  typeof document !== "undefined" && document.fullscreenElement !== null;
const canFullscreen = () =>
  typeof document !== "undefined" && document.fullscreenEnabled;

/**
 * Exam mode on the exercise page: asks for fullscreen and reports leaving
 * the window (tab switch, other app, minimise, leaving fullscreen) to the
 * teacher. Browsers can't prevent any of this; it's logged, not blocked.
 */
export function ExamGuard({ itemId }: { itemId: string }) {
  // `mutate` is stable across renders.
  const { mutate: sendEvent } = api.learn.examEvent.useMutation();
  // Starts "true" so server and first client render match; checked below.
  const [full, setFull] = useState(true);

  useEffect(() => {
    const first = setTimeout(
      () => setFull(!canFullscreen() || isFullscreen()),
      0,
    );
    let blurredAt: number | null = null;

    const onBlur = () => {
      blurredAt = Date.now();
    };
    const onFocus = () => {
      if (blurredAt === null) return;
      const ms = Date.now() - blurredAt;
      blurredAt = null;
      if (ms >= MIN_BLUR_MS) {
        sendEvent({ itemId, type: "BLUR", seconds: Math.round(ms / 1000) });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        sendEvent({ itemId, type: "HIDDEN" });
      }
    };
    const onFullscreen = () => {
      const now = isFullscreen();
      setFull(now || !canFullscreen());
      if (!now) sendEvent({ itemId, type: "FULLSCREEN_EXIT" });
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      clearTimeout(first);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [itemId, sendEvent]);

  if (full) return null;
  return (
    <div className="bg-background/95 fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <ShieldAlert className="size-10 text-amber-400" />
        <h2 className="text-xl font-semibold">This is an exam</h2>
        <p className="text-muted-foreground text-sm">
          Work in fullscreen. Leaving fullscreen, switching tabs or switching to
          other programs is recorded and shown to your teacher.
        </p>
        <Button
          size="lg"
          onClick={() =>
            void document.documentElement.requestFullscreen().catch(() => {
              toast.error("Your browser didn't allow fullscreen.");
              setFull(true);
            })
          }
        >
          <Maximize /> Continue in fullscreen
        </Button>
      </div>
    </div>
  );
}

/** Exam: hand in (closes the exam for me; the teacher can reopen it). */
export function HandInButton({
  assignmentId,
  className,
  size = "default",
}: {
  assignmentId: string;
  className?: string;
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const submit = api.learn.submit.useMutation({
    onSuccess: async () => {
      toast.success("Handed in. Good luck!");
      if (isFullscreen()) await document.exitFullscreen().catch(() => null);
      await utils.learn.invalidate();
      router.push(`/learn/a/${assignmentId}`);
      router.refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button
      variant="destructive"
      size={size}
      className={className}
      disabled={submit.isPending}
      onClick={() => {
        if (
          window.confirm(
            "Hand in the exam? You can't change anything afterwards (unless your teacher reopens it).",
          )
        ) {
          submit.mutate({ assignmentId });
        }
      }}
    >
      <Lock /> Hand in exam
    </Button>
  );
}
