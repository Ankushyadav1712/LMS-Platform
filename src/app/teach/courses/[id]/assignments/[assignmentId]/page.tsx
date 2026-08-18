import Link from "next/link";
import { notFound } from "next/navigation";

import { agreementRate } from "@/lib/ai-grading-rules";
import { isAiGradingConfigured } from "@/lib/ai-grading";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { requirePageRole } from "@/lib/guards";

import { AssignmentForm } from "./assignment-form";
import { GradingQueue } from "./grading-queue";

export default async function AssignmentEditorPage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const actor = await requirePageRole("/teach", "INSTRUCTOR", "ADMIN");
  const { id, assignmentId } = await params;

  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { course: true },
  });
  if (!assignment || assignment.courseId !== id || !can.manageCourse(actor, assignment.course)) {
    notFound();
  }

  // Grading queue: every attempt (each is independently gradable), grouped
  // by student with the newest attempt first within each student.
  const submissions = await db.submission.findMany({
    where: { assignmentId },
    include: {
      student: { select: { id: true, name: true, email: true } },
      grades: { orderBy: { gradedAt: "desc" }, take: 1 },
      // Append-only history; the newest row is the current draft.
      aiReviews: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ studentId: "asc" }, { attemptNumber: "desc" }],
  });

  // Agreement rate across this assignment's reviewed AI drafts — the honest
  // measurement behind any "instructors accepted N% of AI drafts" claim.
  // Filtered by submission id, not through the `submission` relation: the
  // relation filter put the predicate on the joined table, so no index on
  // ai_reviews could prune it and the scan grew with *global* review volume.
  // `submissions` above is every submission for this assignment, so the id
  // sets are identical.
  const actionCounts = await db.aiReview.groupBy({
    by: ["instructorAction"],
    where: { submissionId: { in: submissions.map((s) => s.id) } },
    _count: { _all: true },
  });
  const countFor = (action: string) =>
    actionCounts.find((c) => c.instructorAction === action)?._count._all ?? 0;
  const agreement = agreementRate({
    accepted: countFor("ACCEPTED"),
    edited: countFor("EDITED"),
    rejected: countFor("REJECTED"),
  });

  return (
    <section className="space-y-8">
      <div>
        <Link
          href={`/teach/courses/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {assignment.course.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{assignment.title}</h1>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <AssignmentForm
          assignment={{
            id: assignment.id,
            title: assignment.title,
            instructions: assignment.instructions,
            rubric: assignment.rubric,
            dueAt: assignment.dueAt?.toISOString() ?? null,
            maxPoints: assignment.maxPoints,
            allowLate: assignment.allowLate,
            maxAttempts: assignment.maxAttempts,
            isPublished: assignment.isPublished,
          }}
        />
        <GradingQueue
          maxPoints={assignment.maxPoints}
          aiEnabled={isAiGradingConfigured()}
          agreement={agreement}
          submissions={submissions.map((s) => ({
            id: s.id,
            attemptNumber: s.attemptNumber,
            isLate: s.isLate,
            status: s.status,
            submittedAt: s.submittedAt.toISOString(),
            textContent: s.textContent,
            hasFile: Boolean(s.fileKey),
            student: s.student,
            grade: s.grades[0]
              ? { points: s.grades[0].points, feedback: s.grades[0].feedback }
              : null,
            aiReview: s.aiReviews[0]
              ? {
                  draftFeedback: s.aiReviews[0].draftFeedback,
                  suggestedScore: s.aiReviews[0].suggestedScore,
                  model: s.aiReviews[0].model,
                  instructorAction: s.aiReviews[0].instructorAction,
                  injectionReported: s.aiReviews[0].injectionReported,
                }
              : null,
          }))}
        />
      </div>
    </section>
  );
}
