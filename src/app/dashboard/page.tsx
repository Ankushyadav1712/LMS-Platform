import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/sign-out-button";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { toActor } from "@/lib/guards";
import { getCourseProgress } from "@/lib/learn";
import { getSession } from "@/lib/session";

// The real auth boundary: proxy.ts only checks cookie presence.
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard");

  const { user } = session;
  const actor = toActor(user);

  const enrollments = await db.enrollment.findMany({
    where: { studentId: actor.id },
    include: { course: { select: { id: true, slug: true, title: true } } },
    orderBy: { enrolledAt: "desc" },
  });
  const withProgress = await Promise.all(
    enrollments.map(async (e) => ({
      ...e,
      progress: await getCourseProgress(actor.id, e.courseId),
    })),
  );

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <SiteHeader>
        {can.createCourse(actor) ? (
          <Link href="/teach" className="text-sm text-muted-foreground hover:text-foreground">
            Teach
          </Link>
        ) : null}
        {can.administrate(actor) ? (
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            Admin
          </Link>
        ) : null}
        <SignOutButton />
      </SiteHeader>

      <div className="mb-10 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {user.name}</h1>
        <Badge variant="secondary">{user.role}</Badge>
      </div>

      <section>
        <h2 className="mb-4 text-xl font-medium">My courses</h2>
        {withProgress.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Nothing here yet</CardTitle>
              <CardDescription>
                <Link href="/" className="underline underline-offset-4">
                  Browse the catalog
                </Link>{" "}
                and enroll in your first course.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {withProgress.map((e) => (
              <Card key={e.id}>
                <CardHeader>
                  <CardTitle>
                    <Link
                      href={`/courses/${e.course.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {e.course.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {e.progress.completed}/{e.progress.total} lectures · {e.progress.percent}%
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Progress value={e.progress.percent} />
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
