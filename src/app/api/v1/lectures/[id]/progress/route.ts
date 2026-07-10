import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { ForbiddenError } from "@/lib/authz";
import { requireActor } from "@/lib/guards";
import { db } from "@/lib/db";
import { getReadableLecture } from "@/lib/learn";

// Progress heartbeat: articles toggle isCompleted; the video player will
// also stream lastWatchedSecond through this same endpoint (Week 6).
const bodySchema = z
  .object({
    isCompleted: z.boolean(),
    lastWatchedSecond: z
      .number()
      .int()
      .min(0)
      .max(60 * 60 * 24),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Provide at least one field" });

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const data = await parseBody(request, bodySchema);

    // Progress belongs to enrolled students — previews don't track.
    const { lecture, enrollment } = await getReadableLecture(actor, id);
    if (!enrollment) {
      throw new ForbiddenError("Enroll in the course to track progress");
    }

    const progress = await db.lectureProgress.upsert({
      where: { studentId_lectureId: { studentId: actor.id, lectureId: lecture.id } },
      create: {
        studentId: actor.id,
        lectureId: lecture.id,
        isCompleted: data.isCompleted ?? false,
        lastWatchedSecond: data.lastWatchedSecond ?? 0,
        completedAt: data.isCompleted ? new Date() : null,
      },
      update: {
        ...(data.lastWatchedSecond !== undefined
          ? { lastWatchedSecond: data.lastWatchedSecond }
          : {}),
        ...(data.isCompleted !== undefined
          ? { isCompleted: data.isCompleted, completedAt: data.isCompleted ? new Date() : null }
          : {}),
      },
    });

    return NextResponse.json({ progress });
  } catch (e) {
    return errorResponse(e);
  }
}
