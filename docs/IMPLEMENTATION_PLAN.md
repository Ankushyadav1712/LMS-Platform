# LMS Platform — Implementation Plan

> **Goal:** a final-year project that reads as industry-level and gets you placed — not another tutorial-clone LMS.
> **Constraints:** solo build, ~12–15 hrs/week, 14 weeks (July → mid-October 2026, before placement season), budget ≤ $10/mo.
> **Core features:** video lectures, assignments + grading, authentication, role management (student / instructor / admin).

---

## 0. The strategy in one paragraph

Recruiters in 2026 actively pattern-match _against_ tutorial LMS clones ("MERN + JWT + Cloudinary" is a negative signal). What separates you: **one genuinely hard feature done to the bottom** (a video pipeline you built, not an API you called), **an on-brand AI feature** (you're CSE-AI — human-in-the-loop AI grading), **security done properly** (policy-based RBAC with authorization-bypass tests in CI), and **real numbers you measured yourself** (k6 p95, `EXPLAIN ANALYZE` before/after, a real pilot with juniors at NST). Everything else in this plan exists to support those four signals. Ship boring, ship weekly, ship to a URL — the project that gets you placed is the _finished_ one.

---

## 1. Tech Stack (decided — do not re-litigate in week 1)

| Layer              | Choice                                                                                          | Why (the interview answer)                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend + Backend | **Next.js 15 (App Router, TypeScript)** — modular monolith, REST route handlers under `/api/v1` | One deployable, shared types end-to-end. Alternative worth knowing: separate NestJS backend — classic monolith-vs-services tradeoff; you chose the architecture your team size (1) justifies.                  |
| UI                 | **Tailwind CSS + shadcn/ui**                                                                    | Industry-default; shadcn is copy-in code you can fully explain, not a black-box dependency.                                                                                                                    |
| Database           | **PostgreSQL on Neon**                                                                          | LMS data is deeply relational (enrollments, grades, progress are join tables); FKs + unique constraints do real work. Be ready for the SQL-vs-NoSQL question. Neon gives DB-branch-per-PR for preview deploys. |
| ORM                | **Prisma**                                                                                      | Types from schema, migrations built in, huge adoption. Alternative: Drizzle (abstraction vs control).                                                                                                          |
| Auth               | **Better Auth — DB-backed sessions in httpOnly cookies**                                        | Instant revocation (ban/demote takes effect _now_), no refresh-token choreography. Know the JWT alternative cold — this is the single most-asked auth tradeoff in Indian product-company interviews.           |
| File/video storage | **Cloudflare R2** (S3-compatible SDK)                                                           | Zero egress fees — the whole game for video on a student budget. Every S3 talking point (presigned URLs, multipart) still applies.                                                                             |
| Video processing   | **Self-built: ffmpeg on a worker → HLS ladder → R2 → signed URLs** (see §3)                     | The differentiator. Escape hatch: Cloudflare Stream ($5/mo) if the pipeline isn't demo-ready on schedule.                                                                                                      |
| Background jobs    | **pg-boss** (Postgres-backed queue) on a Railway worker                                         | Retries, backoff, dead-letter — real queue semantics without operating Redis. "I know when I'd outgrow it" is a great ADR.                                                                                     |
| Validation         | **Zod** at every API boundary (body, query, **and route params**)                               | Unvalidated `params.id` is where IDOR probing starts.                                                                                                                                                          |
| Email              | **Resend** (password reset, "assignment graded")                                                | Exercises the job queue.                                                                                                                                                                                       |
| Observability      | **Sentry** (errors + p95 traces) + **Axiom** (logs) + **UptimeRobot**                           | All free tiers; produces the resume numbers.                                                                                                                                                                   |
| Deployment         | **Vercel** (app) + **Railway** (worker, ~$5/mo) + **Neon** + **R2**                             | Real multi-service deployment diagram for the README. Total: **~$5–6/mo** + domain (~₹800/yr).                                                                                                                 |

**Why Railway (not Render free) for the worker:** Render free tier spins down (~50s cold start) — fatal in a live interview demo. $5 keeps it warm.

---

## 2. Database Schema (Prisma / Postgres)

Conventions: cuid PKs, all FKs indexed, `createdAt`/`updatedAt` everywhere. Non-enumerable IDs are defense-in-depth, **not** the access control.

| Table                           | Key columns                                                                                                                                                                        | Notes                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `users`                         | email (unique), passwordHash, `role` enum `STUDENT\|INSTRUCTOR\|ADMIN`                                                                                                             | Single enum, not a roles table — see ADR-5                                                      |
| `sessions`, `accounts`          | Better Auth managed                                                                                                                                                                | DB sessions → instant revocation                                                                |
| `courses`                       | instructorId FK, title, slug (unique), thumbnailKey, `status` enum `DRAFT\|PUBLISHED\|ARCHIVED`, price (0 for v1 — future-proofs payments)                                         | Archive, never hard-delete                                                                      |
| `sections`                      | courseId FK, title, position — unique `(courseId, position)`                                                                                                                       | Chapters                                                                                        |
| `lectures`                      | sectionId FK, `type` enum `VIDEO\|ARTICLE`, position, videoKey/playback fields, durationSeconds, `videoStatus` enum `NONE\|PROCESSING\|READY\|ERRORED`, isFreePreview, isPublished | Article type = cheap content variety                                                            |
| `attachments`                   | courseId/lectureId FK, fileKey, sizeBytes, mimeType                                                                                                                                |                                                                                                 |
| `enrollments`                   | studentId FK, courseId FK, status — **unique `(studentId, courseId)`**                                                                                                             | The DB, not the app, prevents double-enrollment                                                 |
| `lecture_progress`              | studentId, lectureId, isCompleted, lastWatchedSecond — **unique `(studentId, lectureId)`**                                                                                         | Upserted from player heartbeat; course % is _computed_, never stored (no denormalization drift) |
| `assignments`                   | courseId FK, sectionId FK (nullable), instructions, dueAt, maxPoints, allowLate, maxAttempts                                                                                       |                                                                                                 |
| `submissions`                   | assignmentId, studentId, attemptNumber, textContent, fileKey, isLate, `status` enum — **unique `(assignmentId, studentId, attemptNumber)`**                                        | Prior attempts kept (versioned)                                                                 |
| `grades`                        | submissionId FK, graderId FK, points, feedback, gradedAt                                                                                                                           | Separate table → regrades keep history; current grade = latest row                              |
| `ai_reviews`                    | submissionId FK, draftFeedback, suggestedScore, prompt/model metadata, instructorAction enum `ACCEPTED\|EDITED\|REJECTED`                                                          | Powers the instructor-agreement metric (§4)                                                     |
| `webhook_events` / `job_events` | provider, eventId (unique), payload jsonb, processedAt                                                                                                                             | Idempotent async processing — interviewers love this table                                      |
| `notifications`                 | userId, type, payload jsonb, readAt                                                                                                                                                | In-app bell, **no websockets** (see cut list)                                                   |

Relations: `users 1—N courses` (as instructor) · `courses 1—N sections 1—N lectures` · `users N—M courses` via `enrollments` · `assignments 1—N submissions 1—N grades` · `users N—M lectures` via `lecture_progress`.

---

## 3. Video Pipeline (the #1 differentiator)

**Two-stage build — the boring version ships first, the impressive version upgrades it:**

### Stage 1 (Week 6 — MVP): direct MP4, done correctly

- Instructor browser → **presigned PUT** direct to R2 (bytes never touch your API — say exactly that sentence in interviews). Size/MIME enforced in the presign conditions.
- Playback: HTML5 `<video>` from a **short-lived signed URL**, minted only after session + enrollment + published checks.
- Resume playback via `lecture_progress.lastWatchedSecond` heartbeat; auto-complete at ~90% watched.

### Stage 2 (Weeks 7–8): the real pipeline

```
Browser --presigned multipart PUT--> R2 (raw bucket)
   API enqueues pg-boss job --> Railway worker runs ffmpeg:
      360p / 720p / (1080p) HLS ladder, 4–6s segments,
      keyframe-aligned (-g / keyint) so quality switching doesn't stutter
      + thumbnail extraction
   Renditions --> R2 (processed, private)
   Status transitions: UPLOADED -> PROCESSING -> READY | ERRORED
      (idempotent jobs, exponential-backoff retries, dead-letter queue)
   Playback --> hls.js player, short-TTL signed URLs, enrollment-gated
```

- **Go/no-go rule (write it down now so it's a plan, not a failure):** if HLS isn't demo-ready by end of Week 8, cut over to **Cloudflare Stream** and move on. The interview story survives either way — you built the pipeline locally and can whiteboard it.
- Know the AWS-scale version cold for interviews: S3 events → SQS → ECS/MediaConvert workers → CloudFront with **signed cookies** (not signed URLs — an HLS session makes hundreds of segment requests; one cookie scoped to `/course-123/*` covers them all).
- State the honest limit: signed URLs deter sharing; they are not DRM.

---

## 4. AI-Assisted Grading (the on-brand differentiator — you're CSE-AI)

Scoped tightly. **The AI never grades autonomously — instructor-in-the-loop by design** (this is itself a great interview answer about AI in high-stakes decisions):

1. On submission (text/code), a background job sends it + the instructor's rubric to an LLM → drafts rubric-anchored feedback + a suggested score into `ai_reviews`.
2. Grading queue shows the draft; instructor **accepts / edits / rejects**. Every prompt/output logged.
3. Metrics you can honestly measure: **instructor-agreement rate** and **grading-time reduction** (stopwatch real sessions).
4. _Stretch inside the same week, first thing to cut:_ plagiarism similarity — embedding cosine + MinHash shingling across the submission corpus, flagging pairs for human review; measure precision on a seeded near-duplicate test set. **Hard scope line: do not attempt a Turnitin.**

---

## 5. Auth & RBAC — three layers (each is a distinct interview talking point)

1. **Edge middleware (coarse, UX only):** redirects — never the security boundary.
2. **Route-handler guards (role):** every handler opens with `requireRole(...)`; no handler trusts middleware.
3. **Policy layer (resource ownership) — the one that matters:** a single central module (`can(user, action, resource)`), because role checks alone can't stop instructor A grading instructor B's students — that's an IDOR waiting to happen.

```ts
export async function assertCanManageCourse(user: SessionUser, courseId: string) {
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError();
  if (course.instructorId !== user.id && user.role !== "ADMIN") throw new ForbiddenError();
  return course;
}
```

Rules: every query scoped (`WHERE id = ? AND owner = me`), **404 not 403** for resources the user shouldn't know exist, explicit Zod field allowlists on updates (never `data: {...body}` — that's how a student PATCHes `role: "admin"`), role changes only via a dedicated admin endpoint. **Ship a scripted authz-attack test suite (IDOR, escalation, cross-tenant reads) that runs in CI** — "I wrote authorization-bypass tests and they run in CI" is a line almost no fresher can say.

---

## 6. API Surface (~25 endpoints, REST under `/api/v1`)

- **Auth:** sign-up / sign-in / sign-out (Better Auth) · `GET /me`
- **Catalog:** `GET /courses` (search, filter, cursor pagination) · `GET /courses/:slug`
- **Authoring** _(owner)_: `POST/PATCH /courses` · `POST /courses/:id/publish` (validates completeness) · sections + lectures CRUD · `PUT /courses/:id/sections/reorder` (one transaction)
- **Video:** `POST /lectures/:id/video/upload` (presign) · `GET /lectures/:id/playback` (enrollment check → signed URL) · worker status callbacks
- **Enrollment/progress:** `POST /courses/:id/enroll` · `GET /me/enrollments` · `PUT /lectures/:id/progress` (heartbeat upsert) · `GET /courses/:id/progress`
- **Assignments:** CRUD _(owner)_ · `POST /assignments/:id/submissions` (enforces deadline/attempts) · `GET /assignments/:id/submissions` (grading queue) · `POST /submissions/:id/grade` · `GET /me/grades`
- **Files:** `POST /uploads/presign` (MIME/size validated, keys namespaced `submissions/{userId}/…`)
- **Admin:** users list/search · `PATCH /admin/users/:id/role` · deactivate · `GET /admin/stats` (counts only)

Errors as `{ error: { code, message } }`; every list cursor-paginated.

---

## 7. Week-by-Week Roadmap (14 weeks, ~12–15 hrs/wk, ~170 hrs)

**Prime directive: deployed and clickable by end of Week 1; demo-worthy by end of Week 6; everything after compounds.**

| Week    | Deliverable ("working X")                                                                                                                                                                                                                                                                                | Definition of done                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **1**   | **Walking skeleton:** Next.js + TS + Prisma + Neon scaffold, one page reading from prod DB, **deployed on Vercel with CI** (lint/typecheck/test/build), Docker Compose for local (Postgres + MinIO), ERD sketch in README                                                                                | A stranger visits a real URL and sees DB-backed content. CI green. Retrofitting CI later is misery — wire it now.          |
| **2**   | **Auth:** Better Auth email+password + Google OAuth, role enum, protected routes                                                                                                                                                                                                                         | Sign up → log out → log in on prod; session survives refresh                                                               |
| **3**   | **RBAC:** central `can()` policy layer, role-gated `/dashboard` `/teach` `/admin` (server-side), admin can promote users, seed script (1 admin, 2 instructors, 5 students)                                                                                                                               | Student hitting instructor API via curl gets 403/404. 5–8 unit tests on `can()` — cheapest tests, biggest interview payoff |
| **4**   | **Instructor authoring:** course → sections → lectures CRUD, draft/publish, **cover-image upload to R2** (low-stakes warm-up for the video storage plumbing)                                                                                                                                             | Instructor builds a 2-section course with 4 article lectures through the UI                                                |
| **5**   | **Student experience:** catalog + search, course page, one-click enroll (free), lecture viewer, progress %                                                                                                                                                                                               | Full prod story: sign up → browse → enroll → read → progress bar moves; non-enrolled blocked server-side                   |
| **6**   | **Video, the boring way** (§3 Stage 1) — **🚩 MVP LINE**                                                                                                                                                                                                                                                 | A real 100MB+ lecture uploads, plays, seeks, resumes on prod for an enrolled student — and 403s for anyone else            |
| **7–8** | **Video pipeline upgrade** (§3 Stage 2): pg-boss + ffmpeg worker → HLS ladder → hls.js playback. **End of W8 = go/no-go: ship HLS or cut to Cloudflare Stream**                                                                                                                                          | Throttle DevTools network and watch quality switch — the demo-video money shot                                             |
| **9**   | **Assignments + submissions:** authoring (rubric, due date, points, attempts), student submits text/file (reuses presign plumbing), late-flagging, versioned attempts                                                                                                                                    | Student submits PDF + text; instructor sees it                                                                             |
| **10**  | **Grading:** per-assignment grading queue, score + feedback, student gradebook, CSV export, in-app notifications (table + bell, no websockets), graded email via job                                                                                                                                     | Full loop: assign → submit → grade → student sees feedback. Instructor cannot grade an unowned course (test it)            |
| **11**  | **AI-assisted grading** (§4) + integrity sweep: ~15–20 integration tests on the authz matrix (the IDOR regression suite)                                                                                                                                                                                 | Instructor-agreement metric logging works; attack-suite green in CI                                                        |
| **12**  | **Hardening + minimal admin:** rate limiting (auth/presign/submit), security headers, empty/loading/error states, mobile pass on 6 core screens, Sentry + password reset email, **N+1 audit + `EXPLAIN ANALYZE` before/after (keep both query plans in the repo)**, admin user management + stats counts | 2 hours trying to break your own app (wrong role, expired session, giant file, double-submit); fix what you find           |
| **13**  | **Portfolio layer:** README rewrite (§9), 5–7 ADRs, seeded demo data (realistic course names, all submission states), demo accounts per role, **2-min demo video**, 5 Playwright E2E flows, **k6 run against prod → record p95**                                                                         | A recruiter with 90 seconds and no login understands the project from README + video alone                                 |
| **14**  | **Buffer.** Do not plan features here.                                                                                                                                                                                                                                                                   | If everything is done: plagiarism similarity, or certificates. Nothing else is approved.                                   |

**Pilot (parallel, Sept–Oct):** recruit **20–40 juniors/classmates at NST** to use it for a real mini-course. A genuine 40-user pilot beats "scalable to 10k users" fiction — it produces your uptime, user-count, and grading-time numbers, and one honest postmortem for the README.

**Checkpoint demos:** W3 (mentor: "what would you try to break?" → file as W12 items) · W6 MVP (watch non-technical friends use it silently) · W10 (a placed senior: "which feature sounds tutorial?") · W13 (cold mock interview; every fumbled question goes in your interview-FAQ doc).

---

## 8. Scope Cuts (say these sentences in interviews)

| Cut                         | One-line rationale                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Payments                    | Free enroll + `price` column stubs it; gateways are integration plumbing, not engineering signal       |
| Live classes (WebRTC)       | A product in itself; a half-working live class demos worse than none                                   |
| Mobile app                  | Responsive web reaches every demo device; second client = double surface, zero new backend signal      |
| Real-time chat / websockets | Notification table covers it; interviewers have heard the socket.io story a thousand times             |
| Quizzes / auto-grading      | Manual grading exercises the harder workflow (queues, feedback, gradebook)                             |
| Analytics dashboards        | Chart-library frontend with no depth — every tutorial clone has one. Ship completion % and counts only |
| Certificates                | "Completed ✓" badge stubs it                                                                           |
| Multi-tenancy               | Single-tenant keeps authz honest; whiteboard the tenant-id migration if asked                          |
| DRM                         | Signed URLs + enrollment gating solve the actual requirement; say so explicitly                        |

**Risk register:** (1) video complexity spiral → boring version ships W6, HLS has a written go/no-go; (2) big-bang deploy → deployed W1, every DoD says "on prod"; (3) scope creep → this cut list is a contract with yourself; (4) RBAC as afterthought → dedicated week + CI attack suite; (5) burnout/coursework collision → 12–15 hrs is honest, W14 is pure buffer, MVP at W6 means a 40% slip still leaves a demoable product.

---

## 9. Engineering Quality Layer

**CI/CD (GitHub Actions):** PR pipeline < 5 min — lint, typecheck, Vitest (unit + integration against a service-container Postgres), build, then **preview deploy with a Neon DB branch per PR** (the feature that makes reviewers say "this person has worked somewhere real"). On merge: migrate → deploy → Sentry release. Playwright on merge + nightly, not every push. Dependabot weekly. Branch protection on `main` — yes, even solo.

**Testing (sized for one person):**

- Unit: `can()` policy matrix (table-driven, all role × resource combos), grading math, deadline/timezone edges, Zod schemas, signed-URL expiry/scoping.
- Integration (highest-value layer): the authz matrix as executable tests, submission lifecycle, enrollment enforcement, presign rejection.
- E2E: exactly 5 Playwright flows — signup→role landing; author→upload→process→enroll→play; submit→grade→see feedback; **student B opens student A's submission URL → 404, no leak**; admin role change takes effect.
- Coverage: **~70% on server/business logic, zero ceremony on UI components.** "70% on the code that can lose someone's grade" is the answer that lands; chasing a global number is tutorial behavior.

**Repo hygiene recruiters actually notice:** conventional commits (commitlint + husky) · **PR-based flow even solo** (60 well-described PRs reads as "worked on a team"; 200 commits to main reads as tutorial) · `docker compose up` = full local stack, 3 commands to running · seed script with demo accounts for all roles · migration discipline (never edit an applied migration) · `.env.example` + boot-time env validation (t3-env) · run a security review pass before "done" and mention it in the README.

**Observability:** pino structured logs with request-IDs (propagated into jobs) → Axiom; Sentry on client + server + worker with sourcemaps; UptimeRobot on `/api/health` (checks DB + queue depth; doubles as free-tier keep-warm); Lighthouse CI nightly. **Resume numbers methodology:** k6 script (e.g. 100–500 VUs hitting browse/presign/gradebook for 5 min) against prod, raw output committed to `/docs/benchmarks` — you can defend a measured number for ten minutes; an invented one collapses at "how exactly did you measure p95?"

---

## 10. ADRs to write (`/docs/adr/` — the highest-leverage 3 hours of the project)

1. **Modular monolith over microservices** — team size of 1; kept module seams (`/modules/courses`, `/modules/grading`) for the split I'd grow into.
2. **DB sessions over stateless JWT** — instant revocation matters in an LMS; one indexed read is negligible in a single-datastore system. Know the JWT+rotating-refresh-token+reuse-detection design cold anyway.
3. **Self-built HLS pipeline over Mux** — inverted build-vs-buy: at a real company I'd buy (say so!), but the pipeline is the point of a portfolio project; documented exit path both directions.
4. **Direct-to-storage uploads over proxying** — serverless body limits, double bandwidth; server keeps control by minting scoped expiring URLs; consequence: async completion → idempotent event handling.
5. **pg-boss over Redis/BullMQ** — one datastore on a student budget; I know the trigger to outgrow it.
6. **R2 over S3** — zero egress is the whole game for video delivery; real cost-engineering narrative.
7. **Single role enum + ownership checks over a permissions engine** — three fixed roles don't justify RBAC tables; real granularity lives in ownership checks. Trigger to revisit: TAs → `course_members` table.

---

## 11. Resume bullets (targets — replace every number with what you actually measure)

1. Built and deployed a full-stack LMS (Next.js/TypeScript, PostgreSQL, ffmpeg workers) **serving 40+ real students and 3 instructors** in a campus pilot, sustaining 99.9% uptime over 8 weeks with Sentry monitoring and structured logging.
2. Engineered an **adaptive HLS video pipeline** — presigned multipart uploads to object storage, queue-backed ffmpeg workers producing a 360p/720p/1080p rendition ladder, enrollment-gated signed playback — cutting median video start time from ~6s to **<1.5s** and enabling smooth playback on 3G-class networks.
3. Reduced instructor grading time by **~X%** across 300+ submissions with an LLM-assisted, rubric-anchored feedback workflow requiring human approval, tracking an instructor-agreement rate on every AI draft.
4. Held **p95 API latency under 200ms at 500 concurrent users (k6)** by profiling with `EXPLAIN ANALYZE`, adding composite indexes and eliminating N+1 queries (course page 480ms → 95ms — both query plans committed to the repo).
5. Shipped **zero authorization bypasses under a scripted attack suite** — policy-based RBAC with resource-ownership checks across 3 roles, rotating sessions, per-route rate limiting, and CI-enforced security regression tests; ~70% coverage on core services.

**The governing rule:** every bullet must survive three consecutive "why?" follow-ups. Keep raw evidence (k6 output, query plans, screenshots) in `/docs/benchmarks`.

## 12. Interview question map (rehearse until you can go 3 levels deep, no notes)

| Question                                                   | Hook answer                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Design YouTube / Udemy-lite"                              | "I built this end-to-end — let me start with why video bytes never touch my API server." _(Practice this one as a full 35-min mock — it alone justifies the project.)_ |
| "How does adaptive bitrate streaming work?"                | "I generate the ladder myself with ffmpeg, so I can tell you exactly what's in an `.m3u8`."                                                                            |
| "What if a worker dies mid-transcode?"                     | "Jobs are idempotent with atomic status transitions, backoff retries, and a dead-letter queue — a dead worker's job gets re-leased."                                   |
| "JWT vs sessions? How do you revoke?"                      | "I chose DB sessions for instant revocation and will defend that tradeoff; here's the rotating-refresh-token design I'd use in a distributed system."                  |
| "What stops instructor A grading instructor B's students?" | "Role checks alone can't — that's an IDOR. Every request goes through a `can(user, action, resource)` policy layer, and CI tests attempt exactly that bypass."         |
| "A query got slow. Walk me through it."                    | "It happened: `EXPLAIN ANALYZE` showed a seq scan on the course page; a composite index took it 480ms → 95ms; both plans are in the repo."                             |
| "You let AI grade students?"                               | "It never grades — it drafts; the instructor owns the verdict, and I track an agreement rate. In high-stakes decisions the human decides."                             |
| "How do you _know_ it's fast/correct?"                     | "I don't claim, I measure — k6 raw output, Sentry prod traces, and a 70%-coverage test pyramid on the code that can lose someone's grade."                             |

## 13. README checklist (the 10-second recruiter test)

One-line pitch + hero GIF (upload → processing → adaptive playback) → **live URL + demo credentials table above the fold** (`student@demo… / instructor@demo… / admin@demo…`, nightly data-reset cron) → architecture diagram (image, in-repo, async paths labeled differently from sync) → numbers table linking to `/docs/benchmarks` → feature table with depth markers ("HLS pipeline — hand-rolled ffmpeg ladder, not Mux") → 3-command local setup + CI/coverage badges → `/docs/adr/` → **"Known limitations & at 100x scale I would…"** — the honesty section no fresher writes, which reads as senior and hands interviewers the follow-ups you've already prepped.

---

_Plan synthesized 2026-07-07 from four design passes (architecture, roadmap, placement-impact, engineering-quality) + reconciliation. Key resolved decisions: staged video (boring W6 → self-built HLS W7–8 with Cloudflare Stream escape hatch), pg-boss over Redis, Better Auth DB sessions, AI grading promoted from stretch goal to dedicated week._
