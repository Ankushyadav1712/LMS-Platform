import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { draftFeedback, isAiGradingConfigured } from "@/lib/ai-grading";
import { can, DomainError, NotFoundError } from "@/lib/authz";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { enforceRateLimit } from "@/lib/rate-limit";

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

    // Every draft costs real money at the model provider — rate limit before
    // spending any of it.
    await enforceRateLimit(actor.id, "ai-draft");

    const draft = await draftFeedback({
      assignmentTitle: submission.assignment.title,
      instructions: submission.assignment.instructions,
      rubric: submission.assignment.rubric,
      maxPoints: submission.assignment.maxPoints,
      submissionText: submission.textContent,
      hasFile: Boolean(submission.fileKey),
      isLate: submission.isLate,
    });

    // Append-only (same as Grade rows): re-drafting adds a row rather than
    // overwriting, so an already-recorded ACCEPTED/EDITED/REJECTED can never be
    // erased from the agreement metric. Any older draft still PENDING is
    // resolved as REJECTED — the instructor rolled it over by re-drafting.
    const aiReview = await db.$transaction(async (tx) => {
      await tx.aiReview.updateMany({
        where: { submissionId: submission.id, instructorAction: "PENDING" },
        data: { instructorAction: "REJECTED" },
      });
      return tx.aiReview.create({
        data: {
          submissionId: submission.id,
          draftFeedback: draft.feedback,
          suggestedScore: draft.suggestedScore,
          model: draft.model,
          promptTokens: draft.promptTokens,
          completionTokens: draft.completionTokens,
          injectionReported: draft.injectionAttempted,
        },
      });
    });

    return NextResponse.json({ aiReview });
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

    // The row survives as history; only its verdict changes.
    const updated = await db.aiReview.updateMany({
      where: { submissionId: submission.id, instructorAction: "PENDING" },
      data: { instructorAction: "REJECTED" },
    });
    return NextResponse.json({ dismissed: updated.count });
  } catch (e) {
    return errorResponse(e);
  }
}
