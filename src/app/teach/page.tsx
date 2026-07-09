import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageRole } from "@/lib/guards";
import { db } from "@/lib/db";

export default async function TeachPage() {
  const actor = await requirePageRole("/teach", "INSTRUCTOR", "ADMIN");

  const courses = await db.course.findMany({
    where: { instructorId: actor.id },
    select: { id: true, title: true, status: true, _count: { select: { enrollments: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Your courses</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Course authoring lands in Week 4 — this lists what you own so far.
      </p>
      {courses.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>No courses yet</CardTitle>
            <CardDescription>The course builder arrives next week.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {courses.map((course) => (
            <Card key={course.id}>
              <CardHeader>
                <CardTitle>{course.title}</CardTitle>
                <CardDescription>
                  {course.status} · {course._count.enrollments} enrolled
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
