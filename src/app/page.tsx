import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { presignDownload } from "@/lib/s3";
import { getSession } from "@/lib/session";

// Rendered per-request: the catalog reads live data and must not be
// prerendered at build time (CI builds have no database).
export const dynamic = "force-dynamic";

async function getCatalog(q?: string, categorySlug?: string) {
  try {
    const courses = await db.course.findMany({
      where: {
        status: "PUBLISHED",
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      include: {
        instructor: { select: { name: true } },
        category: { select: { name: true, slug: true } },
        sections: {
          where: { isPublished: true },
          select: { _count: { select: { lectures: { where: { isPublished: true } } } } },
        },
        _count: { select: { enrollments: true } },
      },
    });
    const withThumbnails = await Promise.all(
      courses.map(async (course) => ({
        ...course,
        thumbnailUrl: course.thumbnailKey ? await presignDownload(course.thumbnailKey) : null,
      })),
    );
    return { courses: withThumbnails, dbDown: false as const };
  } catch {
    return { courses: [], dbDown: true as const };
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;
  const [{ courses, dbDown }, session, categories] = await Promise.all([
    getCatalog(q?.trim() || undefined, category),
    getSession(),
    db.category.findMany({ orderBy: { name: "asc" } }).catch(() => []),
  ]);

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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-medium">Course catalog</h2>
          <form action="/" className="flex w-full max-w-xs items-center gap-2">
            <Input name="q" placeholder="Search courses…" defaultValue={q ?? ""} />
            {category ? <input type="hidden" name="category" value={category} /> : null}
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>

        {categories.length > 0 ? (
          <div className="mb-6 flex flex-wrap gap-2">
            <CategoryChip
              label="All"
              href={q ? `/?q=${encodeURIComponent(q)}` : "/"}
              active={!category}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                label={c.name}
                href={`/?category=${c.slug}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                active={category === c.slug}
              />
            ))}
          </div>
        ) : null}

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
              <CardTitle>No courses found</CardTitle>
              <CardDescription>
                {q || category ? (
                  <>
                    Nothing matches this search.{" "}
                    <Link href="/" className="underline underline-offset-4">
                      Clear filters
                    </Link>
                  </>
                ) : (
                  <>
                    Seed demo data with <code>pnpm db:seed</code>.
                  </>
                )}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {courses.map((course) => {
              const lectureCount = course.sections.reduce((sum, s) => sum + s._count.lectures, 0);
              return (
                <Link key={course.id} href={`/courses/${course.slug}`} className="group">
                  <Card className="overflow-hidden pt-0 transition-colors group-hover:border-foreground/30">
                    {course.thumbnailUrl ? (
                      // Presigned URL is memoized server-side — plain <img>
                      // keeps the browser cache effective.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={course.thumbnailUrl}
                        alt=""
                        className="aspect-video w-full object-cover"
                      />
                    ) : (
                      <div className="aspect-video w-full bg-muted" />
                    )}
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
                      {course.instructor.name} · {lectureCount} lectures ·{" "}
                      {course._count.enrollments} enrolled
                    </CardFooter>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function CategoryChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
