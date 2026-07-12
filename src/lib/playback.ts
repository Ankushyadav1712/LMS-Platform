import { can, NotFoundError, type Actor } from "@/lib/authz";
import { db } from "@/lib/db";

/**
 * The one playback gate, shared by the playback endpoint and the HLS
 * playlist proxies: session ✓ (caller), published chain ✓ (unless owner),
 * enrollment or free-preview or ownership ✓. 404-masked otherwise.
 */
export async function getPlayableLecture(actor: Actor, lectureId: string) {
  const lecture = await db.lecture.findUnique({
    where: { id: lectureId },
    include: { section: { include: { course: true } } },
  });
  if (!lecture) throw new NotFoundError("Lecture not found");

  const course = lecture.section.course;
  const isOwner = can.manageCourse(actor, course);
  const published =
    lecture.isPublished && lecture.section.isPublished && course.status === "PUBLISHED";
  if (!isOwner && !published) throw new NotFoundError("Lecture not found");

  if (!isOwner && !lecture.isFreePreview) {
    const enrollment = await db.enrollment.findUnique({
      where: { studentId_courseId: { studentId: actor.id, courseId: course.id } },
    });
    if (!enrollment) throw new NotFoundError("Lecture not found");
  }

  return { lecture, isOwner };
}

/**
 * Playable HLS build if one exists — including the previous build while a
 * replacement transcodes (students keep watching during re-processing).
 */
export function playableHlsKey(lecture: {
  playbackKey: string | null;
  videoStatus: string;
}): string | null {
  if (!lecture.playbackKey) return null;
  if (lecture.videoStatus === "READY" || lecture.videoStatus === "PROCESSING") {
    return lecture.playbackKey;
  }
  return null;
}
