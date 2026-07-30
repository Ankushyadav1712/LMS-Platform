import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { can, NotFoundError } from "@/lib/authz";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { presignDownload } from "@/lib/s3";

/**
 * Short-lived presigned download for a submitted file. Visible to the
 * submitting student or the course owner/admin — anyone else gets 404 so
 * submission IDs leak nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    const submission = await db.submission.findUnique({
      where: { id },
      include: { assignment: { include: { course: { select: { instructorId: true } } } } },
    });
    if (!submission?.fileKey) throw new NotFoundError("File not found");

    const isOwnerOrAdmin = can.gradeSubmission(actor, {
      courseInstructorId: submission.assignment.course.instructorId,
    });
    if (submission.studentId !== actor.id && !isOwnerOrAdmin) {
      throw new NotFoundError("File not found");
    }

    const url = await presignDownload(submission.fileKey);
    return NextResponse.redirect(url);
  } catch (e) {
    return errorResponse(e);
  }
}
