import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { assertStillPublishable, getOwnedSection } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";

const bodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    isPublished: z.boolean(),
  })
  .partial();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const section = await getOwnedSection(actor, id);
    const data = await parseBody(request, bodySchema);

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.section.update({ where: { id: section.id }, data });
      // Hiding the course's last visible content while it is PUBLISHED
      // rolls back with a 409 — unpublish the course first.
      if (section.course.status === "PUBLISHED" && data.isPublished === false) {
        await assertStillPublishable(tx, section.courseId);
      }
      return u;
    });
    return NextResponse.json({ section: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
