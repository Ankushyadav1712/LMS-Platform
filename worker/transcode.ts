import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

import { createId } from "@paralleldrive/cuid2";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { buildMasterPlaylist, ffmpegArgs, pickRenditions } from "../src/lib/hls";
import type { PrismaClient } from "../src/generated/prisma/client";

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
};

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let errTail = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      errTail = (errTail + d.toString()).slice(-2000); // keep the useful tail
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${cmd} exited with ${code}: …${errTail.slice(-500)}`)),
    );
  });
}

async function probe(inputPath: string): Promise<{ height: number; durationSeconds: number }> {
  const json = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=height",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    inputPath,
  ]);
  const parsed = JSON.parse(json) as {
    streams?: { height?: number }[];
    format?: { duration?: string };
  };
  const height = parsed.streams?.[0]?.height;
  const duration = Number(parsed.format?.duration);
  if (!height || !Number.isFinite(duration)) {
    throw new Error("ffprobe could not read video stream metadata");
  }
  return { height, durationSeconds: Math.round(duration) };
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

export type TranscodeDeps = {
  db: PrismaClient;
  s3: S3Client;
  bucket: string;
};

export type TranscodeJobData = { lectureId: string; rawKey: string };

/**
 * The pipeline job: raw upload -> ffprobe -> per-rendition ffmpeg (keyframe-
 * aligned HLS) -> hand-written master playlist -> upload build -> flip the
 * lecture to READY. Idempotent and staleness-safe: if the lecture's raw key
 * changed while we worked (video replaced), the result is discarded.
 */
export async function transcode(deps: TranscodeDeps, job: TranscodeJobData): Promise<string> {
  const { db, s3, bucket } = deps;

  const lecture = await db.lecture.findUnique({
    where: { id: job.lectureId },
    include: { section: { select: { courseId: true } } },
  });
  if (!lecture || lecture.videoKey !== job.rawKey) {
    return "stale: lecture missing or video replaced — skipping";
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "lms-transcode-"));
  try {
    // 1. Download the raw upload.
    const inputPath = path.join(tmp, "input");
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: job.rawKey }));
    await pipeline(obj.Body as Readable, createWriteStream(inputPath));

    // 2. Probe → pick the ladder (never upscale).
    const { height, durationSeconds } = await probe(inputPath);
    const renditions = pickRenditions(height);

    // 3. Encode each rung, keyframe-aligned so quality switches are seamless.
    const outDir = path.join(tmp, "hls");
    for (const rendition of renditions) {
      const renditionDir = path.join(outDir, rendition.name);
      await mkdir(renditionDir, { recursive: true });
      await run("ffmpeg", ffmpegArgs({ inputPath, outDir: renditionDir, rendition }));
    }
    await writeFile(path.join(outDir, "master.m3u8"), buildMasterPlaylist(renditions));

    // 4. Upload the build under a fresh prefix (replacements never collide).
    const prefix = `videos/${lecture.section.courseId}/${lecture.id}/hls/${createId()}/`;
    for (const filePath of await walkFiles(outDir)) {
      const key = prefix + path.relative(outDir, filePath).split(path.sep).join("/");
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: await readFile(filePath),
          ContentType: CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        }),
      );
    }

    // 5. Flip to READY — only if this raw key is still current.
    const oldPlaybackKey = lecture.playbackKey;
    const updated = await db.lecture.updateMany({
      where: { id: lecture.id, videoKey: job.rawKey },
      data: {
        playbackKey: `${prefix}master.m3u8`,
        videoStatus: "READY",
        durationSeconds,
      },
    });
    if (updated.count === 0) {
      await deletePrefix(deps, prefix); // lost the race to a replacement
      return "stale: video replaced during transcode — build discarded";
    }

    // 6. Old build is now unreachable — clean it up (best effort).
    if (oldPlaybackKey) {
      await deletePrefix(deps, oldPlaybackKey.replace(/master\.m3u8$/, ""));
    }

    return `ready: ${renditions.length} renditions (${renditions.map((r) => r.name).join(", ")}), ${durationSeconds}s`;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Delete every object under a prefix (HLS builds are whole directories). */
export async function deletePrefix(deps: TranscodeDeps, prefix: string): Promise<void> {
  try {
    const { s3, bucket } = deps;
    let token: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length > 0) {
        await s3.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
        );
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } catch (e) {
    console.error(`cleanup of ${prefix} failed:`, e);
  }
}
