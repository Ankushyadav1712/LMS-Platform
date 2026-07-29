import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { LocalDateTime } from "@/components/local-datetime";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSubmittableAssignment } from "@/lib/assignments";
import { NotFoundError } from "@/lib/authz";
import { db } from "@/lib/db";
import { toActor } from "@/lib/guards";
import { evaluateSubmissionWindow } from "@/lib/submission-rules";
import { getSession } from "@/lib/session";

import { SubmitForm } from "./submit-form";

export default async function StudentAssignmentPage({
  params,
}: {
  params: Promise<{ slug: string; assignmentId: string }>;
}) {
  const { slug, assignmentId } = await params;
  const session = await getSession();
  if (!session) notFound();
  const actor = toActor(session.user);

  let assignment;
  try {
    assignment = await getSubmittableAssignment(actor, assignmentId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const course = await db.course.findUnique({
    where: { id: assignment.course.id },
    select: { slug: true, title: true },
  });
  if (!course || course.slug !== slug) notFound();

  const submissions = await db.submission.findMany({
    where: { assignmentId, studentId: actor.id },
    include: { grades: { orderBy: { gradedAt: "desc" }, take: 1 } },
    orderBy: { attemptNumber: "desc" },
  });

  const window = evaluateSubmissionWindow({
    now: new Date(),
    dueAt: assignment.dueAt,
    allowLate: assignment.allowLate,
    maxAttempts: assignment.maxAttempts,
    usedAttempts: submissions.length,
  });

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <SiteHeader>
        <Link
          href={`/courses/${slug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {course.title}
        </Link>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </Link>
      </SiteHeader>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{assignment.title}</h1>
        <Badge variant="outline">{assignment.maxPoints} pts</Badge>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {assignment.dueAt ? (
          <>
            Due <LocalDateTime iso={assignment.dueAt.toISOString()} />
          </>
        ) : (
          "No due date"
        )}{" "}
        · {assignment.maxAttempts} attempt{assignment.maxAttempts === 1 ? "" : "s"}
        {assignment.allowLate ? " · late allowed" : ""}
      </p>

      <div className="prose prose-neutral mb-8 max-w-none dark:prose-invert">
        <Markdown remarkPlugins={[remarkGfm]}>{assignment.instructions}</Markdown>
      </div>

      {assignment.rubric ? (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">Rubric</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm prose-neutral max-w-none dark:prose-invert">
            <Markdown remarkPlugins={[remarkGfm]}>{assignment.rubric}</Markdown>
          </CardContent>
        </Card>
      ) : null}

      <SubmitForm
        assignmentId={assignmentId}
        canSubmit={window.allowed}
        willBeLate={window.isLate}
        closedReason={window.reason ?? null}
        attemptsLeft={assignment.maxAttempts - submissions.length}
      />

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-medium">Your submissions</h2>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attempts yet.</p>
        ) : (
          <div className="space-y-3">
            {submissions.map((s) => {
              const grade = s.grades[0];
              return (
                <Card key={s.id}>
                  <CardContent className="space-y-2 py-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Attempt {s.attemptNumber}</span>
                      <span className="flex items-center gap-2">
                        {s.isLate ? <Badge variant="secondary">Late</Badge> : null}
                        {grade ? (
                          <Badge>
                            {grade.points}/{assignment.maxPoints}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Awaiting grade</Badge>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <LocalDateTime iso={s.submittedAt.toISOString()} />
                    </p>
                    {s.textContent ? (
                      <p className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">
                        {s.textContent}
                      </p>
                    ) : null}
                    {s.fileKey ? (
                      <a
                        href={`/api/v1/submissions/${s.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-sm underline underline-offset-4"
                      >
                        Your uploaded file
                      </a>
                    ) : null}
                    {grade?.feedback ? (
                      <div className="rounded border-l-2 border-foreground/20 bg-muted/50 p-2 text-sm">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Feedback</p>
                        {grade.feedback}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
