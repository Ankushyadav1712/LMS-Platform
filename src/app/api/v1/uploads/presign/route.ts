import { createId } from "@paralleldrive/cuid2";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { DomainError } from "@/lib/authz";
import { getOwnedCourse } from "@/lib/courses";
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

// Course thumbnails only, for now. Submissions and video reuse this pattern
// with their own namespaces in later weeks.
const bodySchema = z.object({
  purpose: z.literal("course-thumbnail"),
  courseId: z.string().min(1),
  contentType: z.string(),
  contentLength: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const body = await parseBody(request, bodySchema);

    const course = await getOwnedCourse(actor, body.courseId);

    const ext = IMAGE_TYPES[body.contentType];
    if (!ext) {
      throw new DomainError("UNSUPPORTED_TYPE", "Only JPEG, PNG or WebP images are allowed");
    }
    if (body.contentLength > MAX_IMAGE_BYTES) {
      throw new DomainError("TOO_LARGE", "Image must be 5MB or smaller");
    }

    // Server-generated key: namespaced to the course, never user-controlled.
    const key = `thumbnails/${course.id}/${createId()}.${ext}`;
    const url = await presignUpload({
      key,
      contentType: body.contentType,
      contentLength: body.contentLength,
    });

    return NextResponse.json({ url, key });
  } catch (e) {
    return errorResponse(e);
  }
}
