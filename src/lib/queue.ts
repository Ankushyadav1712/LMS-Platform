import { PgBoss } from "pg-boss";

import { env } from "@/env";

export const TRANSCODE_QUEUE = "transcode-video";
export const TRANSCODE_DLQ = "transcode-video-dlq";

export type TranscodeJob = {
  lectureId: string;
  rawKey: string;
};

// One pg-boss instance per process (same global-stash pattern as db.ts).
const globalForBoss = globalThis as unknown as { boss: PgBoss | undefined };

async function createBoss(): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on("error", (e: Error) => console.error("pg-boss error:", e));
  await boss.start();
  await boss.createQueue(TRANSCODE_DLQ);
  await boss.createQueue(TRANSCODE_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    deadLetter: TRANSCODE_DLQ,
  });
  return boss;
}

export async function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.boss) {
    globalForBoss.boss = await createBoss();
  }
  return globalForBoss.boss;
}

/** Enqueue a transcode; jobs are idempotent on (lectureId, rawKey). */
export async function enqueueTranscode(job: TranscodeJob): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(TRANSCODE_QUEUE, job);
}
