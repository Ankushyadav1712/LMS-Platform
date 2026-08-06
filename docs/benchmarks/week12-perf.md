# Week 12 — query performance audit

Four hot read paths were profiled against a realistic dataset. Three had real
defects; one was healthy and left alone. **No index was added and no migration
was written** — every fix is a query-shape change served by an index that
already existed.

Raw `EXPLAIN (ANALYZE, BUFFERS)` output, before and after each change, is in
[week12-query-plans.md](week12-query-plans.md).

## Method

The demo seed has single-digit row counts, and Postgres sequentially scans a
6-row table no matter how it is indexed — so plans against it prove nothing.
`pnpm db:seed:load` generates a benchmark dataset first:

| table            | rows   |
| ---------------- | ------ |
| users            | 406    |
| courses          | 11     |
| lectures         | 246    |
| enrollments      | 3,203  |
| submissions      | 3,200  |
| grades           | 1,500  |
| lecture_progress | 19,203 |

Every SQL statement examined was captured from Prisma's own query-event log
rather than reconstructed by hand, then re-run under `EXPLAIN (ANALYZE,
BUFFERS)` with bind parameters substituted as literals. Timings are medians of
warm runs.

Two things are measured separately, because they answer different questions:

- **Query-level** (`EXPLAIN`) — shows _why_ a plan is bad: which index, how many
  buffers, how many rows discarded.
- **End-to-end through Prisma** — shows what a user would actually feel,
  including round trips the fix doesn't touch.

At this data size query-level ratios are dominated by _planning_ time and swing
run to run (the same script produced 10×–20× for one fix with no code change).
**Buffer counts and end-to-end timings are the numbers to trust.**

## Fixes applied

### 1. Gradebook — redundant 400-element `studentId IN (...)`

`getGradebook` filtered submissions by both `studentId IN (400 ids)` and
`assignmentId IN (4 ids)`. The student list was logically redundant: those four
assignments already scope the course. Worse, it drove the planner to
`submissions_studentId_idx`, which reads every submission those 400 students
ever made _across every course_ and then discards the ones from other courses —
`Rows Removed by Filter: 2800`, i.e. 7 of every 8 rows read for nothing. It also
shipped ~11 KB of bind parameters per request, and planning cost more than
execution.

Dropping it makes `assignmentId` the driving predicate, so the existing
`submissions_assignmentId_studentId_attemptNumber_key` index is used on its
leading column. The same edit swaps `include` → `select`, so the query stops
pulling `textContent`, `fileKey`, `isLate`, `status` and `submittedAt` (plan
`width` 199 → 56) to compute a matrix of integers.

Narrowing the columns is what turns the fix from good into free: every column
still selected lives _in_ that index, so the plan becomes an **Index Only Scan** —
the heap is never touched at all.

- **`Index Scan` (78 buffers, 2,800 rows discarded) → `Index Only Scan` (7 buffers, 0 discarded)**
- **End-to-end `getGradebook()`: 8.4–9.5 ms → 4.5–4.8 ms (1.8–2.0×)** on a
  401-student course, across 5 separate runs of `bench:verify`

Reported as a range because a single run is not evidence: one early run came out
at 1.2× and would have been the wrong number to quote. The fix improves one of
the five statements in this call, so the end-to-end gain is real but bounded —
~1.9×, not the 20× the query-level plan comparison can suggest.

The student list _was_ doing one real job — excluding `DROPPED` students — so
that now happens in memory against the enrollment set.

> This was the only behavioural risk in the whole pass, and the first
> verification run reported it as **untested** — no `DROPPED` enrollment existed
> on any course with assignments, so the filter was never exercised.
> `verify-query-edge-cases.ts` now creates the case: it drops a student who has a
> graded cell, asserts they vanish from both `students[]` and `cells` while their
> submission still matches the `assignmentId` filter (proving the in-memory
> filter, not the query, is doing the excluding), then restores the enrollment
> and re-checks the cell came back.

### 2. Dashboard — 2N+2 queries for N enrolled courses

`dashboard/page.tsx` called `getCourseProgress` once per enrollment, and each
call issued two `count` queries — 18 queries for an 8-course student, 16 of them
redundant, re-scanning the same `lectures` and `sections` sixteen times.

Replaced with `getProgressForCourses`: two grouped aggregates for all courses at
once. Prisma cannot `groupBy` across a relation, so these are `$queryRaw`.

- **18 queries → 4**; buffers ~136 → ~17
- **End-to-end: ~2.0 ms → ~0.55 ms (3.4–4.1×)** at N=8, across 5 runs

The grouped query costs about what **one** of the eight per-course pairs cost, so
the win grows with enrollment count — this is the fix that matters most as the
platform fills up, even though it is the smallest absolute saving today.

`getCourseProgress` is kept for the single-course caller
(`courses/[slug]/page.tsx`) — at N=1 the grouped version is marginally _slower_.
Both now share one pure `toProgress()` so the two paths cannot drift on rounding.

### 3. AI agreement rate — predicate on the joined table

The grading queue's agreement metric used
`where: { submission: { assignmentId } }`. That puts the predicate on
`submissions`, not `ai_reviews`, so **no index on `ai_reviews` could prune it**:
cost scaled with total AI-review volume across every course in the system, not
with the assignment being viewed. `ai_reviews` is append-only and never pruned,
so this only ever gets worse.

Replaced with `submissionId: { in: ids }`, reusing ids the page already fetched.

- **`Seq Scan` over all 28,800 rows → `Bitmap Index Scan` over the 900 that
  belong to this assignment.** This is the whole point: the old plan's cost was
  proportional to global review volume, the new one to page scope.
- **Execution: 4.74 ms → 0.93 ms**; end-to-end through Prisma **3.71 ms → 1.78 ms
  (2.1×)** at 28,800 review rows

One honest wrinkle: **buffer count goes _up_** here (1,384 → 2,091), which looks
wrong until you look at how the synthetic data was written. The 9 drafts of any
one submission were inserted in 9 passes over all 3,200 submissions, so they land
~3,200 rows apart — worst-case clustering, and the bitmap heap scan pays for it
(`Heap Blocks: exact=1791` to return 900 rows). Real usage drafts a submission's
reviews minutes apart, not 3,200 rows apart, so they cluster far better. The
rows-processed and execution-time improvements are real; **this particular buffer
number is an artefact of the benchmark, not a regression** — and is exactly why
the structural claim above, not a buffer count, is the one worth making.

This defect is **invisible at head** — `ai_reviews` is empty, so before/after
match trivially. To measure it, 9 drafts per submission (28,800 rows) were
inserted, `ANALYZE`d, measured, and deleted. Equivalence was then re-verified
across all 33 assignments _with that data present_, which is the only way the
comparison means anything.

## Deliberately not done

Each of these was measured, not assumed:

- **No new index.** Every index that would help already exists.
- **`@@index([studentId, isCompleted])` on `LectureProgress`** — created and
  measured: the planner does switch to it, but execution moved 0.477 ms →
  0.350 ms (noise) and the underlying access was unchanged. `isCompleted` is
  true for 19,202 of 19,203 rows, so it removes nothing. Dropped.
- **`@@index([assignmentId])` on `Submission`** — redundant; the existing unique
  index already leads with `assignmentId`.
- **`@@index([submissionId, gradedAt])` on `Grade`** — measured, changed nothing.
- **Trigram GIN for catalog search** — built one; the planner _ignored_ it and
  seq-scanned the 11-row `courses` table, which is correct at that size.
- **`relationJoins` preview feature** — verified it works on Prisma 7.8 and it
  does collapse the grading queue from 4 round trips to 1, but total DB time was
  ~3.2 ms → ~3.5 ms: a wash. Not worth shipping a preview flag that changes
  every query in the app for no measurable gain. Revisit when `ai_reviews` has
  real depth per submission.

## Honest caveats

- **No query on any profiled path exceeded 50 ms, before or after.** Total DB
  time per page was single-digit milliseconds throughout. These are structural
  defects — cost growing with enrollment count or with global table size —
  caught before they became incidents, not incidents resolved.
- **Catalog scale is unverified.** The load seed leaves `courses` at 11 rows, so
  the catalog benchmark never exercised the path it was meant to. It was found
  healthy at 11 rows, which is close to meaningless. Genuinely untested, not
  proven fast.
- **The `take: 1` includes are not N+1.** Prisma batches them into one query per
  _relation_, not per row — confirmed by query-event count: 5 statements for a
  400-student gradebook, constant. They do over-fetch (no `LIMIT` is pushed down,
  so `take: 1` is applied in JS), but calling them N+1 would be wrong.
- **One known display quirk, left as-is:** `percent` is a rounded integer, so
  999/1000 lectures displays as "100%". The exact count is always shown next to
  it, and completion is tested with `completed === total`, never with `percent`.
  Pinned in `progress-rules.test.ts` so it stays a decision rather than becoming
  an accident.

## Reproducing

```bash
pnpm db:seed:load   # generate the benchmark dataset (idempotent)
pnpm bench:verify   # prove every re-shaped query returns identical results
pnpm bench:plans    # regenerate week12-query-plans.md
```

`bench:verify` is the important one. It checks 3,204 (student, course) progress
pairs across 403 students, 1,500 gradebook cells across 9 courses, and all 33
assignments' agreement counts — asserting the new query shapes are
indistinguishable from the ones they replaced, including the empty-list,
unknown-course, zero-lecture and dropped-student edge cases.
