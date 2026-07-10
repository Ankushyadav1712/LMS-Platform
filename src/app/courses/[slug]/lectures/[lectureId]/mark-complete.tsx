"use client";

import { Button } from "@/components/ui/button";
import { useApiAction } from "@/lib/use-api-action";

export function MarkComplete({
  lectureId,
  isCompleted,
}: {
  lectureId: string;
  isCompleted: boolean;
}) {
  const { pending, error, run } = useApiAction();

  function toggle() {
    run(() =>
      fetch(`/api/v1/lectures/${lectureId}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: !isCompleted }),
      }),
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={toggle} disabled={pending} variant={isCompleted ? "outline" : "default"}>
        {pending ? "Saving…" : isCompleted ? "✓ Completed — undo" : "Mark as complete"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
