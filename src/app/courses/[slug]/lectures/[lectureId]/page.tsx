import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/authz";
import { db } from "@/lib/db";
import { toActor } from "@/lib/guards";
import { getCourseOutline, getReadableLecture } from "@/lib/learn";
import { getSession } from "@/lib/session";

import { MarkComplete } from "./mark-complete";

export default async function LectureReaderPage({
  params,
}: {
  params: Promise<{ slug: string; lectureId: string }>;
}) {
  const { slug, lectureId } = await params;
  const session = await getSession();
  const actor = session ? toActor(session.user) : null;

  let readable;
  try {
    readable = await getReadableLecture(actor, lectureId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { lecture, courseId, enrollment, canRead } = readable;

  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { slug: true, title: true },
  });
  if (!course || course.slug !== slug) notFound();
  // Locked content: back to the course page, where the enroll button lives.
  if (!canRead) redirect(`/courses/${slug}`);

  const outline = await getCourseOutline(courseId);
  const flat = outline.flatMap((s) => s.lectures.map((l) => ({ ...l, section: s })));
  const index = flat.findIndex((l) => l.id === lecture.id);
  const prev = index > 0 ? flat[index - 1] : null;
  const next = index < flat.length - 1 ? flat[index + 1] : null;

  const progress = enrollment
    ? await db.lectureProgress.findUnique({
        where: { studentId_lectureId: { studentId: actor!.id, lectureId: lecture.id } },
        select: { isCompleted: true },
      })
    : null;

  const accessible = (l: { isFreePreview: boolean }) => Boolean(enrollment) || l.isFreePreview;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <SiteHeader>
        <Link
          href={`/courses/${slug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {course.title}
        </Link>
        {session ? (
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            Dashboard
          </Link>
        ) : null}
      </SiteHeader>

      <div className="grid gap-10 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4 lg:border-r lg:pr-6">
          {outline.map((section) => (
            <div key={section.id}>
              <p className="mb-1 text-sm font-medium">
                {section.position}. {section.title}
              </p>
              <ul className="space-y-1">
                {section.lectures.map((l) => (
                  <li key={l.id}>
                    {accessible(l) ? (
                      <Link
                        href={`/courses/${slug}/lectures/${l.id}`}
                        className={`block rounded px-2 py-1 text-sm ${
                          l.id === lecture.id
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {l.title}
                      </Link>
                    ) : (
                      <span className="block px-2 py-1 text-sm text-muted-foreground/60">
                        🔒 {l.title}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <article>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{lecture.title}</h1>
            {lecture.isFreePreview && !enrollment ? (
              <Badge variant="outline">Free preview</Badge>
            ) : null}
          </div>

          <div className="prose prose-neutral max-w-none dark:prose-invert">
            <Markdown remarkPlugins={[remarkGfm]}>
              {lecture.body ?? "*This lecture has no content yet.*"}
            </Markdown>
          </div>

          <div className="mt-10 space-y-6">
            {enrollment ? (
              <MarkComplete lectureId={lecture.id} isCompleted={progress?.isCompleted ?? false} />
            ) : (
              <p className="text-sm text-muted-foreground">
                <Link href={`/courses/${slug}`} className="underline underline-offset-4">
                  Enroll for free
                </Link>{" "}
                to track your progress.
              </p>
            )}

            <div className="flex items-center justify-between border-t pt-6">
              {prev && accessible(prev) ? (
                <Button
                  variant="outline"
                  render={<Link href={`/courses/${slug}/lectures/${prev.id}`} />}
                >
                  ← {prev.title}
                </Button>
              ) : (
                <span />
              )}
              {next && accessible(next) ? (
                <Button render={<Link href={`/courses/${slug}/lectures/${next.id}`} />}>
                  {next.title} →
                </Button>
              ) : (
                <span />
              )}
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
