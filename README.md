# LMS Platform

A learning management platform — video lectures, assignments with feedback, and role-based courses for students, instructors, and admins. Built as a final-year engineering project with an explicit focus on production-grade practices: real deployment, CI, tests, measured performance, and documented architecture decisions.

## Stack

| Layer               | Technology                                                        |
| ------------------- | ----------------------------------------------------------------- |
| App                 | Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui |
| Database            | PostgreSQL · Prisma 7 (driver adapters)                           |
| Auth _(Week 2)_     | Better Auth — DB-backed sessions                                  |
| Storage _(Week 4+)_ | Cloudflare R2 (MinIO locally)                                     |
| Video _(Weeks 6–8)_ | Presigned uploads → ffmpeg → HLS → signed playback                |
| Jobs _(Week 7+)_    | pg-boss worker                                                    |
| Quality             | Vitest · Playwright _(Week 13)_ · GitHub Actions CI               |

## Local development

```bash
pnpm install        # installs deps + generates Prisma client
pnpm db:setup       # starts Postgres + MinIO (Docker), migrates, seeds demo data
pnpm dev            # http://localhost:3000
pnpm worker         # second terminal: the transcoding worker (needs ffmpeg)
```

Copy `.env.example` to `.env` first (defaults match `docker-compose.yml`). Video uploads require `ffmpeg`/`ffprobe` on PATH (`brew install ffmpeg`) and the worker running — without it, uploads stay in "Transcoding…" forever.

### Demo data

`pnpm db:seed` creates the accounts below (all with password `Demo@1234`), a published course with sections/lectures/an assignment, and enrollments.

| Role       | Email                                     |
| ---------- | ----------------------------------------- |
| Admin      | `admin@demo.lms`                          |
| Instructor | `instructor@demo.lms`                     |
| Student    | `student1@demo.lms` … `student3@demo.lms` |

### Scripts

| Command                                      | What it does                                 |
| -------------------------------------------- | -------------------------------------------- |
| `pnpm dev` / `pnpm build`                    | Dev server / production build                |
| `pnpm worker`                                | Transcoding worker (pg-boss + ffmpeg)        |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | The CI gauntlet, runnable locally            |
| `pnpm format`                                | Prettier over the repo                       |
| `pnpm db:migrate`                            | Create/apply a migration from schema changes |
| `pnpm db:seed`                               | Idempotent demo seed (safe to re-run)        |
| `pnpm db:studio`                             | Prisma Studio data browser                   |

## Architecture notes

- **Video pipeline** (the interesting part): browser → presigned PUT direct to object storage → confirm endpoint verifies the object exists, flips the lecture to `PROCESSING`, and enqueues a pg-boss job → the worker downloads the raw file, probes it, transcodes a keyframe-aligned HLS ladder with ffmpeg (360p/720p/1080p, never upscaling), hand-writes the master playlist, uploads the build under a fresh prefix, and flips to `READY` — staleness-safe if the video was replaced mid-transcode. Failures retry with backoff, then dead-letter and mark the lecture `ERRORED`. Playback: **playlists proxy through the API** (tiny text, auth-checked on every request) while **segment bytes stream straight from storage** via presigned URLs embedded in the rewritten playlists — one auth check covers a hundred segment requests, the same problem CloudFront signed cookies solve.
- **Modular monolith** on Next.js — one deployable; module seams kept clean so a service split stays possible. The transcoding worker is already a separate process (`worker/`) with its own clients, deployable independently. Rationale for every major decision will live in `docs/adr/`.
- **Schema-first**: the full domain model (courses → sections → lectures, enrollments, submissions → grades, AI reviews, idempotent job events) is in [prisma/schema.prisma](prisma/schema.prisma). Invariants live in the database: unique `(studentId, courseId)` prevents double-enrollment, unique `(assignmentId, studentId, attemptNumber)` versions submissions.
- **CI** runs lint, format check, typecheck, tests, and build in parallel on every PR ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
