import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Load-test seed: generates enough rows that query plans are realistic.
 * Postgres will happily seq-scan a 6-row table no matter how it's indexed, so
 * EXPLAIN ANALYZE against the demo seed proves nothing.
 *
 * Idempotent: re-running tops up to the target counts rather than duplicating.
 * Separate from `pnpm db:seed` — this is for benchmarking, not demos.
 */

const TARGET = {
  students: 400,
  coursesPerInstructor: 8,
  sectionsPerCourse: 5,
  lecturesPerSection: 6,
  assignmentsPerCourse: 4,
};

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const started = Date.now();
  const instructor = await db.user.findFirstOrThrow({ where: { role: "INSTRUCTOR" } });

  // --- students ---
  const existingLoadStudents = await db.user.count({ where: { email: { startsWith: "load-" } } });
  const toCreate = Math.max(TARGET.students - existingLoadStudents, 0);
  if (toCreate > 0) {
    await db.user.createMany({
      data: Array.from({ length: toCreate }, (_, i) => {
        const n = existingLoadStudents + i;
        return {
          name: `Load Student ${n}`,
          email: `load-${n}@load.test`,
          emailVerified: true,
          role: "STUDENT" as const,
        };
      }),
    });
  }
  const students = await db.user.findMany({
    where: { email: { startsWith: "load-" } },
    select: { id: true },
  });

  // --- courses / sections / lectures / assignments ---
  for (let c = 0; c < TARGET.coursesPerInstructor; c++) {
    const slug = `load-course-${c}`;
    const course = await db.course.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title: `Load Course ${c}`,
        description: `Generated course ${c} for query benchmarking.`,
        instructorId: instructor.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    for (let s = 0; s < TARGET.sectionsPerCourse; s++) {
      const section = await db.section.upsert({
        where: { courseId_position: { courseId: course.id, position: s + 1 } },
        update: {},
        create: {
          courseId: course.id,
          title: `Section ${s + 1}`,
          position: s + 1,
          isPublished: true,
        },
      });

      for (let l = 0; l < TARGET.lecturesPerSection; l++) {
        await db.lecture.upsert({
          where: { sectionId_position: { sectionId: section.id, position: l + 1 } },
          update: {},
          create: {
            sectionId: section.id,
            title: `Lecture ${s + 1}.${l + 1}`,
            position: l + 1,
            type: "ARTICLE",
            body: "Generated lecture body.",
            isPublished: true,
          },
        });
      }
    }

    const assignmentCount = await db.assignment.count({ where: { courseId: course.id } });
    if (assignmentCount < TARGET.assignmentsPerCourse) {
      await db.assignment.createMany({
        data: Array.from({ length: TARGET.assignmentsPerCourse - assignmentCount }, (_, a) => ({
          courseId: course.id,
          title: `Assignment ${assignmentCount + a + 1}`,
          instructions: "Generated assignment for benchmarking.",
          maxPoints: 100,
          isPublished: true,
        })),
      });
    }

    // --- enrollments: every student in every load course ---
    await db.enrollment.createMany({
      data: students.map((s) => ({ studentId: s.id, courseId: course.id })),
      skipDuplicates: true,
    });
  }

  // --- progress + submissions: dense enough to matter ---
  const loadCourses = await db.course.findMany({
    where: { slug: { startsWith: "load-course-" } },
    select: { id: true, sections: { select: { lectures: { select: { id: true } } } } },
  });
  const lectureIds = loadCourses.flatMap((c) =>
    c.sections.flatMap((s) => s.lectures.map((l) => l.id)),
  );

  const progressExisting = await db.lectureProgress.count({
    where: { student: { email: { startsWith: "load-" } } },
  });
  if (progressExisting < 8000) {
    // Each student completes a slice of the lectures.
    const rows = students.flatMap((s, si) =>
      lectureIds
        .filter((_, li) => (li + si) % 5 === 0)
        .map((lectureId) => ({
          studentId: s.id,
          lectureId,
          isCompleted: true,
          lastWatchedSecond: 120,
          completedAt: new Date(),
        })),
    );
    for (let i = 0; i < rows.length; i += 2000) {
      await db.lectureProgress.createMany({ data: rows.slice(i, i + 2000), skipDuplicates: true });
    }
  }

  const assignments = await db.assignment.findMany({
    where: { course: { slug: { startsWith: "load-course-" } } },
    select: { id: true },
  });
  const submissionsExisting = await db.submission.count({
    where: { student: { email: { startsWith: "load-" } } },
  });
  if (submissionsExisting < 3000) {
    const rows = students.flatMap((s, si) =>
      assignments
        .filter((_, ai) => (ai + si) % 4 === 0)
        .map((a) => ({
          assignmentId: a.id,
          studentId: s.id,
          attemptNumber: 1,
          textContent: "Generated submission body for benchmarking.",
          status: "SUBMITTED" as const,
        })),
    );
    for (let i = 0; i < rows.length; i += 2000) {
      await db.submission.createMany({ data: rows.slice(i, i + 2000), skipDuplicates: true });
    }
  }

  // Grade roughly half the submissions so gradebook queries have data.
  const ungraded = await db.submission.findMany({
    where: { student: { email: { startsWith: "load-" } }, grades: { none: {} } },
    select: { id: true },
    take: 1500,
  });
  if (ungraded.length > 0) {
    await db.grade.createMany({
      data: ungraded.map((s, i) => ({
        submissionId: s.id,
        graderId: instructor.id,
        points: 60 + (i % 40),
        feedback: "Generated feedback.",
      })),
    });
  }

  await db.$executeRawUnsafe("ANALYZE");

  const counts = {
    users: await db.user.count(),
    courses: await db.course.count(),
    lectures: await db.lecture.count(),
    enrollments: await db.enrollment.count(),
    submissions: await db.submission.count(),
    grades: await db.grade.count(),
    progress: await db.lectureProgress.count(),
  };
  console.log(`Load seed complete in ${Math.round((Date.now() - started) / 1000)}s:`, counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
