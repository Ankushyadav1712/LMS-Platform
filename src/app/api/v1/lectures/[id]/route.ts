import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { assertStillPublishable, getOwnedLecture } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";

const bodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000).nullable(),
    body: z.string().max(50_000).nullable(),
    isPublished: z.boolean(),
    isFreePreview: z.boolean(),
  })
  .partial();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const lecture = await getOwnedLecture(actor, id);
    const data = await parseBody(request, bodySchema);

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.lecture.update({ where: { id: lecture.id }, data });
      if (lecture.section.course.status === "PUBLISHED" && data.isPublished === false) {
        await assertStillPublishable(tx, lecture.section.courseId);
      }
      return u;
    });
    return NextResponse.json({ lecture: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
