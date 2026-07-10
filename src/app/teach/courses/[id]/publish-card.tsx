"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiAction } from "@/lib/use-api-action";

export function PublishCard({ courseId, status }: { courseId: string; status: string }) {
  const [blockers, setBlockers] = useState<string[]>([]);
  const { pending, error, run } = useApiAction();

  const isPublished = status === "PUBLISHED";
  const isArchived = status === "ARCHIVED";

  function transition(method: "POST" | "DELETE", path: "publish" | "restore") {
    setBlockers([]);
    run(() => fetch(`/api/v1/courses/${courseId}/${path}`, { method }), {
      onError: (body) => {
        const b = body?.error?.blockers;
        if (Array.isArray(b)) setBlockers(b as string[]);
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isArchived ? "Archived" : isPublished ? "Published" : "Publish"}</CardTitle>
        <CardDescription>
          {isArchived
            ? "Read-only. Restore to draft to edit or publish again."
            : isPublished
              ? "Students can find and read this course."
              : "Needs a description and at least one published lecture in a published section."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isArchived ? (
          <Button
            onClick={() => transition("POST", "restore")}
            disabled={pending}
            variant="outline"
            className="w-full"
          >
            {pending ? "Working…" : "Restore to draft"}
          </Button>
        ) : (
          <Button
            onClick={() => transition(isPublished ? "DELETE" : "POST", "publish")}
            disabled={pending}
            variant={isPublished ? "outline" : "default"}
            className="w-full"
          >
            {pending ? "Working…" : isPublished ? "Unpublish" : "Publish course"}
          </Button>
        )}
        {blockers.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : error && blockers.length === 0 ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
