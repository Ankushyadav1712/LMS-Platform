import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toActor } from "@/lib/guards";
import { getCourseProgress, getEnrollment, getPublishedCourseBySlug } from "@/lib/learn";
import { presignDownload } from "@/lib/s3";
import { getSession } from "@/lib/session";

import { EnrollButton } from "./enroll-button";

export default async function CourseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [course, session] = await Promise.all([getPublishedCourseBySlug(slug), getSession()]);
  if (!course) notFound();

  const actor = session ? toActor(session.user) : null;
  const enrollment = actor ? await getEnrollment(actor.id, course.id) : null;
  const progress = enrollment ? await getCourseProgress(actor!.id, course.id) : null;
  const thumbnailUrl = course.thumbnailKey ? await presignDownload(course.thumbnailKey) : null;

  const lectures = course.sections.flatMap((s) => s.lectures);
  const isOwner = actor?.id === course.instructor.id;
  const firstLectureId = lectures[0]?.id;
  const canEnroll = !enrollment && !isOwner && (!actor || actor.role === "STUDENT");

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <SiteHeader>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Catalog
        </Link>
        {session ? (
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            Dashboard
          </Link>
        ) : (
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        )}
      </SiteHeader>

      <div className="grid gap-10 lg:grid-cols-[3fr_2fr]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            {course.category ? <Badge variant="secondary">{course.category.name}</Badge> : null}
            <Badge variant="outline">Free</Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{course.title}</h1>
          <p className="mt-3 text-muted-foreground">{course.description}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            By {course.instructor.name} · {lectures.length} lectures · {course._count.enrollments}{" "}
            enrolled
          </p>

          <div className="mt-6">
            {enrollment && progress ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Progress value={progress.percent} className="max-w-xs" />
                  <span className="text-sm text-muted-foreground">
                    {progress.completed}/{progress.total} · {progress.percent}%
                  </span>
                </div>
                {firstLectureId ? (
                  <Button
                    render={<Link href={`/courses/${course.slug}/lectures/${firstLectureId}`} />}
                  >
                    {progress.completed > 0 ? "Continue learning" : "Start learning"}
                  </Button>
                ) : null}
              </div>
            ) : isOwner ? (
              <Button variant="outline" render={<Link href={`/teach/courses/${course.id}`} />}>
                You teach this course — open the editor
              </Button>
            ) : canEnroll ? (
              <EnrollButton courseId={course.id} slug={course.slug} />
            ) : null}
          </div>
        </div>

        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="aspect-video w-full self-start rounded-xl border object-cover"
          />
        ) : null}
      </div>

      <section className="mt-12">
        <h2 className="mb-4 text-xl font-medium">Curriculum</h2>
        <Card>
          <CardContent className="divide-y p-0">
            {course.sections.map((section) => (
              <div key={section.id} className="px-6 py-4">
                <p className="mb-2 font-medium">
                  {section.position}. {section.title}
                </p>
                <ul className="space-y-1">
                  {section.lectures.map((lecture) => {
                    const accessible = Boolean(enrollment) || isOwner || lecture.isFreePreview;
                    return (
                      <li key={lecture.id} className="flex items-center justify-between text-sm">
                        {accessible ? (
                          <Link
                            href={`/courses/${course.slug}/lectures/${lecture.id}`}
                            className="text-foreground underline-offset-4 hover:underline"
                          >
                            {section.position}.{lecture.position} {lecture.title}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {section.position}.{lecture.position} {lecture.title}
                          </span>
                        )}
                        {lecture.isFreePreview && !enrollment ? (
                          <Badge variant="outline">Free preview</Badge>
                        ) : !accessible ? (
                          <span aria-hidden className="text-muted-foreground">
                            🔒
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
