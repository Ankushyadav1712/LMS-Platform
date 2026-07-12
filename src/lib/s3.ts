import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "@/env";

// One client for MinIO (local) and Cloudflare R2 (production) — both speak
// the S3 API. forcePathStyle is required for MinIO's host layout and is
// accepted by R2.
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

/**
 * Short-lived presigned PUT. ContentType and ContentLength are part of the
 * signature — the client cannot upload a different type or a larger body
 * than what the server approved.
 */
export async function presignUpload(opts: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: opts.key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    }),
    {
      expiresIn: opts.expiresInSeconds ?? 300,
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
}

// Presigned GETs are memoized until shortly before expiry: object keys are
// immutable (content never changes under a key), and a stable URL lets the
// browser actually cache thumbnails instead of refetching per render.
const DOWNLOAD_TTL_SECONDS = 3600;
const downloadCache = new Map<string, { url: string; staleAtMs: number }>();

/** Short-lived presigned GET for private objects (thumbnails, files). */
export async function presignDownload(key: string): Promise<string> {
  const cached = downloadCache.get(key);
  if (cached && cached.staleAtMs > Date.now()) return cached.url;

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
    expiresIn: DOWNLOAD_TTL_SECONDS,
  });
  if (downloadCache.size > 500) downloadCache.clear();
  downloadCache.set(key, { url, staleAtMs: Date.now() + (DOWNLOAD_TTL_SECONDS - 300) * 1000 });
  return url;
}

/**
 * Playback URLs are minted per request with a long TTL (a lecture must
 * survive a full watch session) and deliberately skip the download memo —
 * a memoized URL could be near expiry when handed out.
 */
export async function presignVideoPlayback(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
    expiresIn: 4 * 3600,
  });
}

/** Small text objects only (HLS playlists) — never use for media bytes. */
export async function getObjectText(key: string): Promise<string> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  const text = await obj.Body?.transformToString();
  if (text === undefined) throw new Error(`Empty object at ${key}`);
  return text;
}

/** Does the object actually exist? Confirm endpoints never trust the client. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Best-effort delete for superseded objects (old thumbnails on replace). */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  } catch (e) {
    // A leaked orphan is better than a failed request.
    console.error(`Failed to delete object ${key}:`, e);
  }
}
