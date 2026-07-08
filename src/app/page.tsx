import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

// Rendered per-request: the catalog reads live data and must not be
// prerendered at build time (CI builds have no database).
export const dynamic = "force-dynamic";

async function getCatalog() {
  try {
    const courses = await db.course.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      include: {
        instructor: { select: { name: true } },
        category: { select: { name: true } },
        sections: { select: { _count: { select: { lectures: true } } } },
        _count: { select: { enrollments: true } },
      },
    });
    return { courses, dbDown: false as const };
  } catch {
    return { courses: [], dbDown: true as const };
  }
}

export default async function Home() {
  const [{ courses, dbDown }, session] = await Promise.all([getCatalog(), getSession()]);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <header className="mb-12 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          LMS Platform
        </Link>
        <nav className="flex items-center gap-2">
          {session ? (
            <Button render={<Link href="/dashboard" />}>Dashboard</Button>
          ) : (
            <>
              <Button variant="ghost" render={<Link href="/login" />}>
                Sign in
              </Button>
              <Button render={<Link href="/signup" />}>Sign up</Button>
            </>
          )}
        </nav>
      </header>

      <section className="mb-12">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
          Learn from real courses. Build real skills.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Video lectures, assignments and feedback — an open learning platform built as a final-year
          engineering project.
        </p>
      </section>

      <section>
        <h2 className="mb-6 text-xl font-medium">Course catalog</h2>

        {dbDown ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Database not reachable</CardTitle>
              <CardDescription>
                Start the local stack, apply migrations and seed demo data:
                <code className="mt-3 block rounded bg-muted p-3 text-sm">pnpm db:setup</code>
              </CardDescription>
            </CardHeader>
          </Card>
        ) : courses.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>No published courses yet</CardTitle>
              <CardDescription>
                Seed demo data with <code>pnpm db:seed</code>.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {courses.map((course) => {
              const lectureCount = course.sections.reduce((sum, s) => sum + s._count.lectures, 0);
              return (
                <Card key={course.id}>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      {course.category ? (
                        <Badge variant="secondary">{course.category.name}</Badge>
                      ) : null}
                      <Badge variant="outline">Free</Badge>
                    </div>
                    <CardTitle className="mt-2">{course.title}</CardTitle>
                    <CardDescription>{course.description}</CardDescription>
                  </CardHeader>
                  <CardFooter className="text-sm text-muted-foreground">
                    {course.instructor.name} · {lectureCount} lectures · {course._count.enrollments}{" "}
                    enrolled
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
