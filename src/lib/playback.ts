import { can, NotFoundError, type Actor } from "@/lib/authz";
import { db } from "@/lib/db";
import { getEnrollment } from "@/lib/learn";

/**
 * The one playback gate, shared by the playback endpoint and the HLS
 * playlist proxies: session ✓ (caller), published chain ✓ (unless owner),
 * effective enrollment (not DROPPED) or free-preview or ownership ✓.
 * 404-masked otherwise.
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
    const enrollment = await getEnrollment(actor.id, course.id);
    if (!enrollment) throw new NotFoundError("Lecture not found");
  }

  return { lecture, isOwner };
}

/**
 * The playable HLS build, independent of transcode state: playbackKey is
 * only ever written by the worker after a COMPLETE build, so if it exists
 * it points at whole, servable content — the last good build keeps playing
 * through a replacement's PROCESSING and even a failed replacement
 * (ERRORED), which only means the *new* upload didn't make it.
 */
export function playableHlsKey(lecture: { playbackKey: string | null }): string | null {
  return lecture.playbackKey;
}
