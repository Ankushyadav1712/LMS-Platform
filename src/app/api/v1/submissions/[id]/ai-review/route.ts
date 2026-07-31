import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { draftFeedback, isAiGradingConfigured } from "@/lib/ai-grading";
import { can, DomainError, NotFoundError } from "@/lib/authz";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";

/**
 * Draft AI feedback for one submission. Course-owner (or admin) only — a
 * student can never trigger a draft on their own work, and 404-masking keeps
 * submission IDs opaque.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    // Authorize BEFORE reporting server configuration: an unauthorized caller
    // gets the 404 mask and learns nothing about our AI setup.
    const submission = await db.submission.findUnique({
      where: { id },
      include: { assignment: { include: { course: { select: { instructorId: true } } } } },
    });
    if (
      !submission ||
      !can.gradeSubmission(actor, {
        courseInstructorId: submission.assignment.course.instructorId,
      })
    ) {
      throw new NotFoundError("Submission not found");
    }

    if (!isAiGradingConfigured()) {
      throw new DomainError(
        "AI_UNAVAILABLE",
        "AI grading is not configured on this server",
        undefined,
        503,
      );
    }

    const draft = await draftFeedback({
      assignmentTitle: submission.assignment.title,
      instructions: submission.assignment.instructions,
      rubric: submission.assignment.rubric,
      maxPoints: submission.assignment.maxPoints,
      submissionText: submission.textContent,
      hasFile: Boolean(submission.fileKey),
      isLate: submission.isLate,
    });

    // One draft per submission: re-drafting replaces the previous one and
    // resets the instructor-action state to PENDING.
    const aiReview = await db.aiReview.upsert({
      where: { submissionId: submission.id },
      create: {
        submissionId: submission.id,
        draftFeedback: draft.feedback,
        suggestedScore: draft.suggestedScore,
        model: draft.model,
        promptTokens: draft.promptTokens,
        completionTokens: draft.completionTokens,
      },
      update: {
        draftFeedback: draft.feedback,
        suggestedScore: draft.suggestedScore,
        model: draft.model,
        promptTokens: draft.promptTokens,
        completionTokens: draft.completionTokens,
        instructorAction: "PENDING",
      },
    });

    return NextResponse.json({
      aiReview,
      // Surfaced so the instructor knows to read the submission sceptically.
      injectionAttempted: draft.injectionAttempted,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Dismiss a draft without grading — recorded as REJECTED for the metric. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    const submission = await db.submission.findUnique({
      where: { id },
      include: { assignment: { include: { course: { select: { instructorId: true } } } } },
    });
    if (
      !submission ||
      !can.gradeSubmission(actor, {
        courseInstructorId: submission.assignment.course.instructorId,
      })
    ) {
      throw new NotFoundError("Submission not found");
    }

    const updated = await db.aiReview.updateMany({
      where: { submissionId: submission.id, instructorAction: "PENDING" },
      data: { instructorAction: "REJECTED" },
    });
    return NextResponse.json({ dismissed: updated.count });
  } catch (e) {
    return errorResponse(e);
  }
}
