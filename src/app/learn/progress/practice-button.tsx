"use client";

import { Dumbbell, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

/** Opens (or makes) my personal practice set for a weak topic. */
export function PracticeButton({ tag, count }: { tag: string; count: number }) {
  const router = useRouter();
  const start = api.learn.startPractice.useMutation({
    onSuccess: (res) => {
      if (res.created) toast.success(`Practice set for “${tag}” is ready`);
      router.push(`/learn/a/${res.id}`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button
      size="sm"
      variant="secondary"
      className="h-7"
      disabled={start.isPending}
      onClick={() => start.mutate({ tag })}
      title={`${count} exercise${count === 1 ? "" : "s"} from the shared library, only for you, no points`}
    >
      {start.isPending ? <Loader2 className="animate-spin" /> : <Dumbbell />}
      Practise
    </Button>
  );
}
