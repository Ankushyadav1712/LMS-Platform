import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { can, DomainError, NotFoundError } from "@/lib/authz";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { presignVideoPlayback } from "@/lib/s3";

/**
 * The playback gate — the whole point of the week. A signed URL is minted
 * only after: session ✓, published chain ✓ (unless owner), enrollment or
 * free-preview or ownership ✓, video READY ✓. Content protection here is
 * access control, not DRM — and we say exactly that in interviews.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    const lecture = await db.lecture.findUnique({
      where: { id },
      include: { section: { include: { course: true } } },
    });
    if (!lecture) throw new NotFoundError("Lecture not found");

    const course = lecture.section.course;
    const isOwner = can.manageCourse(actor, course);
    const published =
      lecture.isPublished && lecture.section.isPublished && course.status === "PUBLISHED";
    if (!isOwner && !published) throw new NotFoundError("Lecture not found");

    if (!isOwner) {
      const enrollment = await db.enrollment.findUnique({
        where: { studentId_courseId: { studentId: actor.id, courseId: course.id } },
      });
      if (!enrollment && !lecture.isFreePreview) {
        throw new NotFoundError("Lecture not found");
      }
    }

    if (lecture.videoStatus !== "READY" || !lecture.videoKey) {
      throw new DomainError("NO_VIDEO", "This lecture has no playable video", undefined, 409);
    }

    const [url, progress] = await Promise.all([
      presignVideoPlayback(lecture.videoKey),
      db.lectureProgress.findUnique({
        where: { studentId_lectureId: { studentId: actor.id, lectureId: lecture.id } },
        select: { lastWatchedSecond: true, isCompleted: true },
      }),
    ]);

    return NextResponse.json({
      url,
      durationSeconds: lecture.durationSeconds,
      resumeAt: progress?.lastWatchedSecond ?? 0,
      isCompleted: progress?.isCompleted ?? false,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
