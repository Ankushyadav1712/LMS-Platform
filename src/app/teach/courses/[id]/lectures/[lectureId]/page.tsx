import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { requirePageRole } from "@/lib/guards";

import { LectureEditor } from "./lecture-editor";

export default async function LectureEditorPage({
  params,
}: {
  params: Promise<{ id: string; lectureId: string }>;
}) {
  const actor = await requirePageRole("/teach", "INSTRUCTOR", "ADMIN");
  const { id, lectureId } = await params;

  const lecture = await db.lecture.findUnique({
    where: { id: lectureId },
    include: { section: { include: { course: true } } },
  });
  if (
    !lecture ||
    lecture.section.courseId !== id ||
    !can.manageCourse(actor, lecture.section.course)
  ) {
    notFound();
  }

  return (
    <section className="space-y-6">
      <div>
        <Link
          href={`/teach/courses/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {lecture.section.course.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {lecture.section.position}.{lecture.position} — {lecture.title}
        </h1>
      </div>
      <LectureEditor
        lecture={{
          id: lecture.id,
          title: lecture.title,
          body: lecture.body,
          isPublished: lecture.isPublished,
          isFreePreview: lecture.isFreePreview,
        }}
      />
    </section>
  );
}
