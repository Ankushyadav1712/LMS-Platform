// Pure publish-readiness rule — no DB, no env — same pattern as authz.ts:
// decisions in a pure module, IO in the service (courses.ts).

/**
 * A publishable course has a description and at least one published lecture
 * inside a published section.
 */
export function computePublishBlockers(course: {
  description: string | null;
  sections: { isPublished: boolean; lectures: { isPublished: boolean }[] }[];
}): string[] {
  const blockers: string[] = [];
  if (!course.description?.trim()) blockers.push("Add a course description");
  const hasVisibleLecture = course.sections.some(
    (s) => s.isPublished && s.lectures.some((l) => l.isPublished),
  );
  if (!hasVisibleLecture) blockers.push("Publish at least one lecture inside a published section");
  return blockers;
}
