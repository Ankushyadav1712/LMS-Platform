import "dotenv/config";

import { S3Client } from "@aws-sdk/client-s3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PgBoss, type Job } from "pg-boss";

import { PrismaClient } from "../src/generated/prisma/client";
import { transcode, type TranscodeDeps, type TranscodeJobData } from "./transcode";

// Self-contained process: own DB pool, own S3 client, plain process.env —
// deploys independently of the Next.js app (Railway service in production).

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

const TRANSCODE_QUEUE = "transcode-video";
const TRANSCODE_DLQ = "transcode-video-dlq";

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv("DATABASE_URL") }),
  });
  const s3 = new S3Client({
    endpoint: requireEnv("S3_ENDPOINT"),
    region: requireEnv("S3_REGION"),
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
  const deps: TranscodeDeps = { db, s3, bucket: requireEnv("S3_BUCKET") };

  const boss = new PgBoss({ connectionString: requireEnv("DATABASE_URL") });
  boss.on("error", (e: Error) => console.error("pg-boss error:", e));
  await boss.start();
  await boss.createQueue(TRANSCODE_DLQ);
  await boss.createQueue(TRANSCODE_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    deadLetter: TRANSCODE_DLQ,
  });

  // Transcoding is CPU-bound: one job at a time per worker process.
  await boss.work<TranscodeJobData>(
    TRANSCODE_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async (jobs: Job<TranscodeJobData>[]) => {
      for (const job of jobs) {
        console.log(`[transcode] start ${job.id} lecture=${job.data.lectureId}`);
        const result = await transcode(deps, job.data); // throw = retry
        console.log(`[transcode] done ${job.id}: ${result}`);
      }
    },
  );

  // Retries exhausted → dead letter → the lecture is marked ERRORED so the
  // instructor sees a real status instead of an eternal spinner.
  await boss.work<TranscodeJobData>(
    TRANSCODE_DLQ,
    { batchSize: 1 },
    async (jobs: Job<TranscodeJobData>[]) => {
      for (const job of jobs) {
        console.error(`[transcode] dead-lettered lecture=${job.data.lectureId}`);
        await db.lecture.updateMany({
          where: { id: job.data.lectureId, videoKey: job.data.rawKey },
          data: { videoStatus: "ERRORED" },
        });
      }
    },
  );

  console.log("Worker up: waiting for transcode jobs");

  const shutdown = async () => {
    console.log("Worker shutting down…");
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
