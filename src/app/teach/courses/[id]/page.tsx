import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { requirePageRole } from "@/lib/guards";
import { presignDownload } from "@/lib/s3";

import { CourseDetailsForm } from "./course-details-form";
import { Curriculum } from "./curriculum";
import { PublishCard } from "./publish-card";
import { ThumbnailUpload } from "./thumbnail-upload";

export default async function CourseEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageRole("/teach", "INSTRUCTOR", "ADMIN");
  const { id } = await params;

  const course = await db.course.findUnique({
    where: { id },
    include: {
      sections: {
        orderBy: { position: "asc" },
        include: { lectures: { orderBy: { position: "asc" } } },
      },
    },
  });
  // 404, not 403: other instructors learn nothing about what exists.
  if (!course || !can.manageCourse(actor, course)) notFound();

  const categories = await db.category.findMany({ orderBy: { name: "asc" } });
  const thumbnailUrl = course.thumbnailKey ? await presignDownload(course.thumbnailKey) : null;

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
        <Badge variant={course.status === "PUBLISHED" ? "default" : "secondary"}>
          {course.status}
        </Badge>
      </div>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          <CourseDetailsForm
            course={{
              id: course.id,
              title: course.title,
              description: course.description,
              categoryId: course.categoryId,
            }}
            categories={categories}
          />
          <Curriculum courseId={course.id} sections={course.sections} />
        </div>
        <div className="space-y-8">
          <PublishCard courseId={course.id} status={course.status} />
          <ThumbnailUpload courseId={course.id} thumbnailUrl={thumbnailUrl} />
        </div>
      </div>
    </section>
  );
}
