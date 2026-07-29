import { createId } from "@paralleldrive/cuid2";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { getSubmittableAssignment } from "@/lib/assignments";
import { DomainError } from "@/lib/authz";
import { getOwnedCourse, getOwnedLecture } from "@/lib/courses";
import { requireActor } from "@/lib/guards";
import { presignUpload } from "@/lib/s3";

// NOTE: per-actor rate limiting for presign issuance lands with the global
// rate-limiting pass in the hardening week (see docs/IMPLEMENTATION_PLAN.md).

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2GB — raw lecture uploads

// Assignment file uploads: a conservative allowlist of document types.
const SUBMISSION_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/plain": "txt",
};
const MAX_SUBMISSION_BYTES = 25 * 1024 * 1024; // 25MB

const bodySchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("course-thumbnail"),
    courseId: z.string().min(1),
    contentType: z.string(),
    contentLength: z.number().int().positive(),
  }),
  z.object({
    purpose: z.literal("lecture-video"),
    lectureId: z.string().min(1),
    contentType: z.string(),
    contentLength: z.number().int().positive(),
  }),
  z.object({
    purpose: z.literal("submission-file"),
    assignmentId: z.string().min(1),
    contentType: z.string(),
    contentLength: z.number().int().positive(),
  }),
]);

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await parseBody(request, bodySchema);

    let key: string;
    if (body.purpose === "course-thumbnail") {
      const course = await getOwnedCourse(actor, body.courseId);
      const ext = IMAGE_TYPES[body.contentType];
      if (!ext) {
        throw new DomainError("UNSUPPORTED_TYPE", "Only JPEG, PNG or WebP images are allowed");
      }
      if (body.contentLength > MAX_IMAGE_BYTES) {
        throw new DomainError("TOO_LARGE", "Image must be 5MB or smaller");
      }
      key = `thumbnails/${course.id}/${createId()}.${ext}`;
    } else if (body.purpose === "lecture-video") {
      const lecture = await getOwnedLecture(actor, body.lectureId);
      const ext = VIDEO_TYPES[body.contentType];
      if (!ext) {
        throw new DomainError("UNSUPPORTED_TYPE", "Only MP4 or WebM video is allowed");
      }
      if (body.contentLength > MAX_VIDEO_BYTES) {
        throw new DomainError("TOO_LARGE", "Video must be 2GB or smaller");
      }
      key = `videos/${lecture.section.courseId}/${lecture.id}/${createId()}.${ext}`;
    } else {
      // submission-file: only an enrolled participant of a published
      // assignment can mint a key, namespaced to their own attempts.
      await getSubmittableAssignment(actor, body.assignmentId);
      const ext = SUBMISSION_TYPES[body.contentType];
      if (!ext) {
        throw new DomainError("UNSUPPORTED_TYPE", "Allowed: PDF, ZIP, PNG, JPEG, or TXT");
      }
      if (body.contentLength > MAX_SUBMISSION_BYTES) {
        throw new DomainError("TOO_LARGE", "File must be 25MB or smaller");
      }
      key = `submissions/${body.assignmentId}/${actor.id}/${createId()}.${ext}`;
    }

    // Server-generated keys, namespaced per resource — never user-controlled.
    const url = await presignUpload({
      key,
      contentType: body.contentType,
      contentLength: body.contentLength,
      // Big files over slow links: give the signature room to breathe.
      expiresInSeconds: body.purpose === "lecture-video" ? 3600 : 300,
    });

    return NextResponse.json({ url, key });
  } catch (e) {
    return errorResponse(e);
  }
}
