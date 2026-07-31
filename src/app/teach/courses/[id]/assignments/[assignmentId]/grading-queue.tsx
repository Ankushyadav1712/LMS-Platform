"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApiAction } from "@/lib/use-api-action";

type AiReview = {
  draftFeedback: string;
  suggestedScore: number | null;
  model: string;
  instructorAction: string;
};

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
  aiReview: AiReview | null;
};

export function GradingQueue({
  submissions,
  maxPoints,
  aiEnabled,
  agreement,
}: {
  submissions: Submission[];
  maxPoints: number;
  aiEnabled: boolean;
  agreement: { reviewed: number; percent: number | null };
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Submissions ({submissions.length})</CardTitle>
          {agreement.percent !== null ? (
            <span className="text-xs text-muted-foreground">
              AI drafts accepted as-is: {agreement.percent}% of {agreement.reviewed} reviewed
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          submissions.map((s) => (
            <Row key={s.id} submission={s} maxPoints={maxPoints} aiEnabled={aiEnabled} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  submission,
  maxPoints,
  aiEnabled,
}: {
  submission: Submission;
  maxPoints: number;
  aiEnabled: boolean;
}) {
  const [points, setPoints] = useState<string | number>(submission.grade?.points ?? "");
  const [feedback, setFeedback] = useState(submission.grade?.feedback ?? "");
  const [open, setOpen] = useState(false);
  const [injectionWarning, setInjectionWarning] = useState(false);
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

  // The AI drafts; the instructor decides. Nothing is graded until they submit.
  function draftWithAi() {
    setInjectionWarning(false);
    run(() => fetch(`/api/v1/submissions/${submission.id}/ai-review`, { method: "POST" }), {
      onSuccess: (body: { aiReview: AiReview; injectionAttempted: boolean }) => {
        setInjectionWarning(body.injectionAttempted);
      },
    });
  }

  function dismissDraft() {
    run(() => fetch(`/api/v1/submissions/${submission.id}/ai-review`, { method: "DELETE" }));
  }

  const ai = submission.aiReview;

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

          {aiEnabled ? (
            <div className="rounded-md border border-dashed p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  AI draft — you review, edit, and approve. Nothing is graded until you save.
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={draftWithAi} disabled={pending}>
                    {pending ? "Drafting…" : ai ? "Re-draft" : "Draft with AI"}
                  </Button>
                  {ai && ai.instructorAction === "PENDING" ? (
                    <Button size="sm" variant="ghost" onClick={dismissDraft} disabled={pending}>
                      Dismiss
                    </Button>
                  ) : null}
                </div>
              </div>

              {injectionWarning ? (
                <p className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
                  ⚠ This submission appears to contain instructions aimed at the AI (a
                  prompt-injection attempt). Read it yourself before grading.
                </p>
              ) : null}

              {ai ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Suggested: {ai.suggestedScore ?? "—"}/{maxPoints} · {ai.model} ·{" "}
                    {ai.instructorAction === "PENDING"
                      ? "awaiting your review"
                      : ai.instructorAction}
                  </p>
                  <p className="whitespace-pre-wrap rounded bg-muted/60 p-2 text-sm">
                    {ai.draftFeedback}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFeedback(ai.draftFeedback);
                      if (ai.suggestedScore !== null) setPoints(ai.suggestedScore);
                    }}
                  >
                    Use this draft
                  </Button>
                </div>
              ) : null}
            </div>
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
              rows={4}
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
