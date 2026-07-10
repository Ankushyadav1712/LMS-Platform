import { can, DomainError, NotFoundError, type Actor } from "@/lib/authz";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

/**
 * Student-facing reads only ever see the published slice: published course,
 * published sections, published lectures. Everything else 404s.
 */
export async function getPublishedCourseBySlug(slug: string) {
  return db.course.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: {
      instructor: { select: { id: true, name: true } },
      category: { select: { name: true } },
      sections: {
        where: { isPublished: true },
        orderBy: { position: "asc" },
        include: {
          lectures: {
            where: { isPublished: true },
            orderBy: { position: "asc" },
            select: { id: true, title: true, position: true, isFreePreview: true, type: true },
          },
        },
      },
      _count: { select: { enrollments: true } },
    },
  });
}

export async function getEnrollment(studentId: string, courseId: string) {
  return db.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
  });
}

/** Idempotent enroll: the unique constraint decides, not a pre-check. */
export async function enrollStudent(actor: Actor, courseId: string) {
  if (!can.enroll(actor)) {
    throw new DomainError("STUDENTS_ONLY", "Only students can enroll in courses", undefined, 403);
  }
  const course = await db.course.findFirst({
    where: { id: courseId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!course) throw new NotFoundError("Course not found");

  try {
    const enrollment = await db.enrollment.create({
      data: { studentId: actor.id, courseId },
    });
    return { enrollment, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const enrollment = await db.enrollment.findUniqueOrThrow({
        where: { studentId_courseId: { studentId: actor.id, courseId } },
      });
      return { enrollment, created: false };
    }
    throw e;
  }
}

/**
 * A lecture is readable when its whole chain is published AND the reader is
 * enrolled (or the lecture is a free preview — including logged-out visitors).
 */
export async function getReadableLecture(actor: Actor | null, lectureId: string) {
  const lecture = await db.lecture.findFirst({
    where: {
      id: lectureId,
      isPublished: true,
      section: { isPublished: true, course: { status: "PUBLISHED" } },
    },
    include: { section: { select: { courseId: true, position: true } } },
  });
  if (!lecture) throw new NotFoundError("Lecture not found");

  const enrollment = actor ? await getEnrollment(actor.id, lecture.section.courseId) : null;
  const canRead = Boolean(enrollment) || lecture.isFreePreview;
  return { lecture, courseId: lecture.section.courseId, enrollment, canRead };
}

/** Course completion, computed — never stored, so it can't drift. */
export async function getCourseProgress(studentId: string, courseId: string) {
  const [total, completed] = await Promise.all([
    db.lecture.count({
      where: {
        isPublished: true,
        section: { isPublished: true, courseId },
      },
    }),
    db.lectureProgress.count({
      where: {
        studentId,
        isCompleted: true,
        lecture: { isPublished: true, section: { isPublished: true, courseId } },
      },
    }),
  ]);
  return {
    total,
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

/** Ordered published lectures of a course — drives prev/next navigation. */
export async function getCourseOutline(courseId: string) {
  return db.section.findMany({
    where: { courseId, isPublished: true },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      position: true,
      lectures: {
        where: { isPublished: true },
        orderBy: { position: "asc" },
        select: { id: true, title: true, position: true, isFreePreview: true, type: true },
      },
    },
  });
}
