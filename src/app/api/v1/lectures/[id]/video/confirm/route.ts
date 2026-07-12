import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { DomainError } from "@/lib/authz";
import { getOwnedLecture } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { enqueueTranscode } from "@/lib/queue";
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
        // The async pipeline: the worker transcodes to an HLS ladder and
        // flips this to READY. An existing build keeps playing meanwhile.
        videoStatus: "PROCESSING",
        durationSeconds: durationSeconds ?? lecture.durationSeconds,
      },
    });

    await enqueueTranscode({ lectureId: lecture.id, rawKey: key });

    // Replacing a video orphans the old raw object — clean it up. (The old
    // HLS build is cleaned by the worker once the new one goes live.)
    if (lecture.videoKey && lecture.videoKey !== key) {
      await deleteObject(lecture.videoKey);
    }

    return NextResponse.json({ lecture: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
