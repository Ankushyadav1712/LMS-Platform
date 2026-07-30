"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApiAction } from "@/lib/use-api-action";

type Submission = {
  id: string;
  attemptNumber: number;
  isLate: boolean;
  status: string;
  submittedAt: string;
  textContent: string | null;
  hasFile: boolean;
  student: { id: string; name: string; email: string };
  grade: { points: number; feedback: string | null } | null;
};

export function GradingQueue({
  submissions,
  maxPoints,
}: {
  submissions: Submission[];
  maxPoints: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Submissions ({submissions.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          submissions.map((s) => <Row key={s.id} submission={s} maxPoints={maxPoints} />)
        )}
      </CardContent>
    </Card>
  );
}

function Row({ submission, maxPoints }: { submission: Submission; maxPoints: number }) {
  const [points, setPoints] = useState(submission.grade?.points ?? "");
  const [feedback, setFeedback] = useState(submission.grade?.feedback ?? "");
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useApiAction();

  function grade(e: React.FormEvent) {
    e.preventDefault();
    run(() =>
      fetch(`/api/v1/submissions/${submission.id}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: Number(points), feedback: feedback.trim() || null }),
      }),
    );
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{submission.student.name}</p>
          <p className="text-xs text-muted-foreground">
            Attempt {submission.attemptNumber} · {new Date(submission.submittedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {submission.isLate ? <Badge variant="secondary">Late</Badge> : null}
          {submission.grade ? (
            <Badge>
              {submission.grade.points}/{maxPoints}
            </Badge>
          ) : (
            <Badge variant="outline">Ungraded</Badge>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Review"}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          {submission.textContent ? (
            <p className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">
              {submission.textContent}
            </p>
          ) : null}
          {submission.hasFile ? (
            <a
              href={`/api/v1/submissions/${submission.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm underline underline-offset-4"
            >
              Download submitted file
            </a>
          ) : null}
          {!submission.textContent && !submission.hasFile ? (
            <p className="text-sm text-muted-foreground">(No content)</p>
          ) : null}

          <form onSubmit={grade} className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={maxPoints}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="Points"
                required
                className="w-28"
                aria-label="Points"
              />
              <span className="text-sm text-muted-foreground">/ {maxPoints}</span>
            </div>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="Feedback (optional)"
            />
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : submission.grade ? "Update grade" : "Save grade"}
              </Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
