import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/lib/guards";
import { db } from "@/lib/db";

import { NewCourseForm } from "./new-course-form";

export default async function TeachPage() {
  const actor = await requirePageRole("/teach", "INSTRUCTOR", "ADMIN");

  const courses = await db.course.findMany({
    where: { instructorId: actor.id },
    select: {
      id: true,
      title: true,
      status: true,
      _count: { select: { enrollments: true, sections: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <section>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Your courses</h1>
          <p className="text-sm text-muted-foreground">
            Create a course, add sections and lectures, then publish.
          </p>
        </div>
        <NewCourseForm />
      </div>

      {courses.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>No courses yet</CardTitle>
            <CardDescription>Create your first course above.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {courses.map((course) => (
            <Link key={course.id} href={`/teach/courses/${course.id}`} className="group">
              <Card className="transition-colors group-hover:border-foreground/30">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant={course.status === "PUBLISHED" ? "default" : "secondary"}>
                      {course.status}
                    </Badge>
                  </div>
                  <CardTitle className="mt-1">{course.title}</CardTitle>
                  <CardDescription>
                    {course._count.sections} sections · {course._count.enrollments} enrolled
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
