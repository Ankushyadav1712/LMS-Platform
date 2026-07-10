import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { DomainError } from "@/lib/authz";
import { getOwnedLecture } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { deleteObject, objectExists } from "@/lib/s3";

const bodySchema = z.object({
  key: z.string().min(1).max(500),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(60 * 60 * 24)
    .optional(),
});

/**
 * Direct-to-storage uploads complete asynchronously — the client reports
 * back, and the server verifies rather than trusts: key must be in this
 * lecture's own namespace AND the object must really exist in the bucket.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const lecture = await getOwnedLecture(actor, id);
    const { key, durationSeconds } = await parseBody(request, bodySchema);

    const prefix = `videos/${lecture.section.courseId}/${lecture.id}/`;
    if (!key.startsWith(prefix)) {
      throw new DomainError("INVALID_KEY", "Key does not belong to this lecture");
    }
    if (!(await objectExists(key))) {
      throw new DomainError(
        "NOT_UPLOADED",
        "No uploaded object found for this key",
        undefined,
        409,
      );
    }

    const updated = await db.lecture.update({
      where: { id: lecture.id },
      data: {
        type: "VIDEO",
        videoKey: key,
        // The boring pipeline: raw MP4 is served as-is, so it is READY the
        // moment it exists. Weeks 7-8 insert PROCESSING + transcoding here.
        videoStatus: "READY",
        durationSeconds: durationSeconds ?? lecture.durationSeconds,
      },
    });

    // Replacing a video orphans the old object — clean it up.
    if (lecture.videoKey && lecture.videoKey !== key) {
      await deleteObject(lecture.videoKey);
    }

    return NextResponse.json({ lecture: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
