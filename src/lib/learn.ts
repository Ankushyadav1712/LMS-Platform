import { can, DomainError, NotFoundError, type Actor } from "@/lib/authz";
import { db } from "@/lib/db";
import { toProgress, type CourseProgress } from "@/lib/progress-rules";
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

/**
 * The effective enrollment for access decisions: DROPPED means revoked, so
 * it never grants access; COMPLETED students keep re-watch rights.
 */
export async function getEnrollment(studentId: string, courseId: string) {
  return db.enrollment.findFirst({
    where: { studentId, courseId, status: { not: "DROPPED" } },
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
  return toProgress(total, completed);
}

/**
 * Progress for many courses in two grouped queries instead of two per course.
 * The dashboard was 2N+2 queries — every extra enrollment added a round trip,
 * and all N pairs re-scanned the same lectures/sections. Prisma can't group
 * across a relation, hence the raw aggregate.
 *
 * Courses with no published lectures are absent from both result sets and fall
 * through to total 0 — same answer getCourseProgress gives them.
 */
export async function getProgressForCourses(
  studentId: string,
  courseIds: string[],
): Promise<Map<string, CourseProgress>> {
  if (courseIds.length === 0) return new Map();

  const [totals, completed] = await Promise.all([
    db.$queryRaw<{ courseId: string; n: bigint }[]>`
      SELECT s."courseId" AS "courseId", COUNT(*)::bigint AS n
      FROM lectures l
      JOIN sections s ON s.id = l."sectionId"
      WHERE l."isPublished" AND s."isPublished" AND s."courseId" = ANY(${courseIds})
      GROUP BY s."courseId"`,
    db.$queryRaw<{ courseId: string; n: bigint }[]>`
      SELECT s."courseId" AS "courseId", COUNT(*)::bigint AS n
      FROM lecture_progress p
      JOIN lectures l ON l.id = p."lectureId"
      JOIN sections s ON s.id = l."sectionId"
      WHERE p."studentId" = ${studentId} AND p."isCompleted"
        AND l."isPublished" AND s."isPublished" AND s."courseId" = ANY(${courseIds})
      GROUP BY s."courseId"`,
  ]);

  const totalBy = new Map(totals.map((r) => [r.courseId, Number(r.n)]));
  const completedBy = new Map(completed.map((r) => [r.courseId, Number(r.n)]));
  return new Map(
    courseIds.map((id) => [id, toProgress(totalBy.get(id) ?? 0, completedBy.get(id) ?? 0)]),
  );
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
