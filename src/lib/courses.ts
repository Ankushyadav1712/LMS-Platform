import { Prisma } from "@/generated/prisma/client";
import { can, DomainError, NotFoundError, type Actor } from "@/lib/authz";
import { db } from "@/lib/db";
import { computePublishBlockers } from "@/lib/publish-rules";
import { slugify, slugifyUnique } from "@/lib/slug";

type DbClient = typeof db | Prisma.TransactionClient;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Archived courses are read-only until explicitly restored. */
function assertWritable(course: { status: string }, forWrite: boolean) {
  if (forWrite && course.status === "ARCHIVED") {
    throw new DomainError("ARCHIVED", "This course is archived — restore it first", undefined, 409);
  }
}

/**
 * Load a course the actor may manage, or throw NotFoundError.
 * 404 — not 403 — for courses the actor doesn't own: another instructor
 * probing ids learns nothing about what exists.
 */
export async function getOwnedCourse(
  actor: Actor,
  courseId: string,
  opts: { forWrite?: boolean } = {},
) {
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || !can.manageCourse(actor, course)) throw new NotFoundError("Course not found");
  assertWritable(course, opts.forWrite ?? true);
  return course;
}

/** Same masking + archived rules, resolved from a section id. */
export async function getOwnedSection(
  actor: Actor,
  sectionId: string,
  opts: { forWrite?: boolean } = {},
) {
  const section = await db.section.findUnique({
    where: { id: sectionId },
    include: { course: true },
  });
  if (!section || !can.manageCourse(actor, section.course)) {
    throw new NotFoundError("Section not found");
  }
  assertWritable(section.course, opts.forWrite ?? true);
  return section;
}

/** Same masking + archived rules, resolved from a lecture id. */
export async function getOwnedLecture(
  actor: Actor,
  lectureId: string,
  opts: { forWrite?: boolean } = {},
) {
  const lecture = await db.lecture.findUnique({
    where: { id: lectureId },
    include: { section: { include: { course: true } } },
  });
  if (!lecture || !can.manageCourse(actor, lecture.section.course)) {
    throw new NotFoundError("Lecture not found");
  }
  assertWritable(lecture.section.course, opts.forWrite ?? true);
  return lecture;
}

/**
 * Create a draft course with a unique slug. Uniqueness is enforced by the
 * DB constraint, not a pre-check: attempt the base slug, and on collision
 * retry with a random suffix.
 */
export async function createCourse(actor: Actor, title: string) {
  const base = slugify(title);
  if (base) {
    try {
      return await db.course.create({ data: { title, slug: base, instructorId: actor.id } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return db.course.create({
    data: {
      title,
      slug: slugifyUnique(title, Math.random().toString(36).slice(2, 8)),
      instructorId: actor.id,
    },
  });
}

/**
 * Append a section/lecture at the next position. The aggregate-then-create
 * pair can race with itself; the (parentId, position) unique constraint
 * catches the loser, and one retry re-reads the committed max.
 */
export async function createSectionAtEnd(courseId: string, title: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const max = await tx.section.aggregate({ where: { courseId }, _max: { position: true } });
        return tx.section.create({
          data: { courseId, title, position: (max._max.position ?? 0) + 1 },
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e) || attempt >= 3) throw e;
    }
  }
}

export async function createLectureAtEnd(sectionId: string, title: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const max = await tx.lecture.aggregate({ where: { sectionId }, _max: { position: true } });
        return tx.lecture.create({
          data: { sectionId, title, position: (max._max.position ?? 0) + 1, type: "ARTICLE" },
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e) || attempt >= 3) throw e;
    }
  }
}

/** Load current state and apply the pure rule. Accepts a tx client so
 * invariant checks can run inside the mutating transaction. */
export async function getPublishBlockers(client: DbClient, courseId: string): Promise<string[]> {
  const course = await client.course.findUniqueOrThrow({
    where: { id: courseId },
    select: {
      description: true,
      sections: {
        select: { isPublished: true, lectures: { select: { isPublished: true } } },
      },
    },
  });
  return computePublishBlockers(course);
}

/**
 * For mutations on a PUBLISHED course that could remove its last visible
 * content: run inside the mutating transaction; throwing rolls it back.
 */
export async function assertStillPublishable(client: DbClient, courseId: string): Promise<void> {
  const blockers = await getPublishBlockers(client, courseId);
  if (blockers.length > 0) {
    throw new DomainError(
      "BREAKS_PUBLISHED_COURSE",
      `This change would leave the published course empty: ${blockers.join(" · ")}. Unpublish the course first.`,
      { blockers },
      409,
    );
  }
}
