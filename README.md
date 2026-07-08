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
```

Copy `.env.example` to `.env` first (defaults match `docker-compose.yml`).

### Demo data

`pnpm db:seed` creates an admin, an instructor, three students, a published course with sections/lectures/an assignment, and enrollments. Login credentials arrive with Better Auth in Week 2.

### Scripts

| Command                                      | What it does                                 |
| -------------------------------------------- | -------------------------------------------- |
| `pnpm dev` / `pnpm build`                    | Dev server / production build                |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | The CI gauntlet, runnable locally            |
| `pnpm format`                                | Prettier over the repo                       |
| `pnpm db:migrate`                            | Create/apply a migration from schema changes |
| `pnpm db:seed`                               | Idempotent demo seed (safe to re-run)        |
| `pnpm db:studio`                             | Prisma Studio data browser                   |

## Architecture notes

- **Modular monolith** on Next.js — one deployable; module seams kept clean so a service split stays possible. Rationale for every major decision will live in `docs/adr/`.
- **Schema-first**: the full domain model (courses → sections → lectures, enrollments, submissions → grades, AI reviews, idempotent job events) is in [prisma/schema.prisma](prisma/schema.prisma). Invariants live in the database: unique `(studentId, courseId)` prevents double-enrollment, unique `(assignmentId, studentId, attemptNumber)` versions submissions.
- **CI** runs lint, format check, typecheck, tests, and build in parallel on every PR ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
