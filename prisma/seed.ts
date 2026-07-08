import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

// Idempotent seed: every write is an upsert keyed on a unique constraint, so
// `pnpm db:seed` can run repeatedly (demo resets, CI, fresh clones).
//
// NOTE: users are seeded without credentials. Better Auth (Week 2) owns
// password hashing; demo passwords get attached to these accounts then.

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  await db.user.upsert({
    where: { email: "admin@demo.lms" },
    update: { role: "ADMIN" },
    create: { name: "Asha Verma", email: "admin@demo.lms", role: "ADMIN", emailVerified: true },
  });

  const instructor = await db.user.upsert({
    where: { email: "instructor@demo.lms" },
    update: { role: "INSTRUCTOR" },
    create: {
      name: "Rahul Mehta",
      email: "instructor@demo.lms",
      role: "INSTRUCTOR",
      emailVerified: true,
    },
  });

  const students = [];
  for (const [i, name] of ["Priya Sharma", "Arjun Patel", "Sneha Iyer"].entries()) {
    students.push(
      await db.user.upsert({
        where: { email: `student${i + 1}@demo.lms` },
        update: {},
        create: { name, email: `student${i + 1}@demo.lms`, role: "STUDENT", emailVerified: true },
      }),
    );
  }

  const webDev = await db.category.upsert({
    where: { slug: "web-development" },
    update: {},
    create: { name: "Web Development", slug: "web-development" },
  });
  const ml = await db.category.upsert({
    where: { slug: "machine-learning" },
    update: {},
    create: { name: "Machine Learning", slug: "machine-learning" },
  });

  const course = await db.course.upsert({
    where: { slug: "full-stack-web-development" },
    update: { status: "PUBLISHED" },
    create: {
      title: "Full-Stack Web Development",
      slug: "full-stack-web-development",
      description:
        "Build production-grade web applications with Next.js, TypeScript and PostgreSQL — from data modeling to deployment.",
      instructorId: instructor.id,
      categoryId: webDev.id,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  const sectionData = [
    {
      title: "Foundations",
      lectures: [
        { title: "How the web works", body: "HTTP, DNS, and the request/response cycle." },
        { title: "Setting up your toolchain", body: "Node, pnpm, TypeScript and editor setup." },
      ],
    },
    {
      title: "Building with Next.js",
      lectures: [
        {
          title: "Routing and layouts",
          body: "App Router fundamentals: pages, layouts, loading states.",
        },
        {
          title: "Data fetching with Server Components",
          body: "Fetching on the server, streaming, and caching.",
        },
        {
          title: "Talking to the database",
          body: "Modeling with Prisma and writing safe queries.",
        },
      ],
    },
  ];

  for (const [sIdx, s] of sectionData.entries()) {
    const section = await db.section.upsert({
      where: { courseId_position: { courseId: course.id, position: sIdx + 1 } },
      update: { title: s.title, isPublished: true },
      create: { courseId: course.id, title: s.title, position: sIdx + 1, isPublished: true },
    });
    for (const [lIdx, l] of s.lectures.entries()) {
      await db.lecture.upsert({
        where: { sectionId_position: { sectionId: section.id, position: lIdx + 1 } },
        update: { title: l.title, body: l.body, isPublished: true },
        create: {
          sectionId: section.id,
          title: l.title,
          body: l.body,
          position: lIdx + 1,
          type: "ARTICLE",
          isPublished: true,
          isFreePreview: sIdx === 0 && lIdx === 0,
        },
      });
    }
  }

  await db.course.upsert({
    where: { slug: "machine-learning-foundations" },
    update: {},
    create: {
      title: "Machine Learning Foundations",
      slug: "machine-learning-foundations",
      description: "Draft course — supervised learning, evaluation, and practical model building.",
      instructorId: instructor.id,
      categoryId: ml.id,
      status: "DRAFT",
    },
  });

  for (const student of students.slice(0, 2)) {
    await db.enrollment.upsert({
      where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
      update: {},
      create: { studentId: student.id, courseId: course.id },
    });
  }

  const firstSection = await db.section.findUniqueOrThrow({
    where: { courseId_position: { courseId: course.id, position: 1 } },
    include: { lectures: { orderBy: { position: "asc" } } },
  });
  await db.lectureProgress.upsert({
    where: {
      studentId_lectureId: {
        studentId: students[0].id,
        lectureId: firstSection.lectures[0].id,
      },
    },
    update: {},
    create: {
      studentId: students[0].id,
      lectureId: firstSection.lectures[0].id,
      isCompleted: true,
      completedAt: new Date(),
    },
  });

  await db.assignment.upsert({
    where: { id: "seed-assignment-1" },
    update: {},
    create: {
      id: "seed-assignment-1",
      courseId: course.id,
      title: "Build a REST API for a todo app",
      instructions:
        "Design and implement CRUD endpoints with validation and error handling. Submit a link to your repository plus a short write-up of your design decisions.",
      rubric:
        "Correctness (40) · API design & validation (30) · Code quality (20) · Write-up clarity (10)",
      dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      maxPoints: 100,
      isPublished: true,
    },
  });

  const counts = {
    users: await db.user.count(),
    courses: await db.course.count(),
    lectures: await db.lecture.count(),
    enrollments: await db.enrollment.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
