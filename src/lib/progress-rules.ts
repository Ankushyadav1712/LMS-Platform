export type CourseProgress = { total: number; completed: number; percent: number };

/**
 * The one place completion percent is computed. Pure so it can be tested
 * without a database, and shared so the single-course path
 * (`getCourseProgress`) and the batched dashboard path
 * (`getProgressForCourses`) can never disagree about the same course.
 *
 * A course with no published lectures is 0%, not 100% — "nothing to do" is not
 * "everything done", and it must never divide by zero.
 */
export function toProgress(total: number, completed: number): CourseProgress {
  return { total, completed, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}
