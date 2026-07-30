"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApiAction } from "@/lib/use-api-action";

type Assignment = {
  id: string;
  title: string;
  isPublished: boolean;
  _count: { submissions: number };
};

export function AssignmentsList({
  courseId,
  assignments,
}: {
  courseId: string;
  assignments: Assignment[];
}) {
  const [title, setTitle] = useState("");
  const { pending, error, run } = useApiAction();

  function add(clear: () => void) {
    if (!title.trim()) return;
    run(
      () =>
        fetch(`/api/v1/courses/${courseId}/assignments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        }),
      { onSuccess: clear },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Assignments</CardTitle>
          <Link
            href={`/teach/courses/${courseId}/gradebook`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Gradebook →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assignments yet.</p>
        ) : (
          <ul className="space-y-1">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/teach/courses/${courseId}/assignments/${a.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  <span>{a.title}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {a._count.submissions} submitted
                    </span>
                    <Badge variant={a.isPublished ? "default" : "secondary"}>
                      {a.isPublished ? "Published" : "Draft"}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(() => setTitle(""));
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New assignment title…"
            aria-label="New assignment title"
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            Add assignment
          </Button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
