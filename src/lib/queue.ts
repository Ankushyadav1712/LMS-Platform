import { PgBoss } from "pg-boss";

import { env } from "@/env";
import {
  TRANSCODE_QUEUE,
  TRANSCODE_QUEUE_OPTIONS,
  TRANSCODE_DLQ,
  type TranscodeJob,
} from "@/lib/queue-config";

export { TRANSCODE_QUEUE, TRANSCODE_DLQ };
export type { TranscodeJob };

// One pg-boss instance per process (same global-stash pattern as db.ts).
// The web tier is a SENDER only: no supervision, no scheduling, no schema
// migration — the worker owns all of that. If the worker has never run
// (no pgboss schema), start() fails and confirm surfaces a clear 503.
const globalForBoss = globalThis as unknown as { boss: PgBoss | undefined };

async function createBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    supervise: false,
    schedule: false,
    migrate: false,
  });
  boss.on("error", (e: Error) => console.error("pg-boss error:", e));
  await boss.start();
  // Idempotent upsert with the shared policy — keeps queue options in sync
  // no matter which process boots first.
  await boss.createQueue(TRANSCODE_DLQ);
  await boss.createQueue(TRANSCODE_QUEUE, TRANSCODE_QUEUE_OPTIONS);
  return boss;
}

export async function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    globalForBoss.boss = await createBoss();
  }
  return globalForBoss.boss;
}

/**
 * Enqueue a transcode. singletonKey dedupes identical (lecture, rawKey)
 * submissions while one is still queued; a replacement upload has a new
 * rawKey and enqueues normally.
 */
export async function enqueueTranscode(job: TranscodeJob): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(TRANSCODE_QUEUE, job, {
    singletonKey: `${job.lectureId}:${job.rawKey}`,
  });
}
