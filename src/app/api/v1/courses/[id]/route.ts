import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { DomainError } from "@/lib/authz";
import { assertStillPublishable, getOwnedCourse } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { deleteObject } from "@/lib/s3";

// Explicit field allowlist — status, slug, instructorId, price can never be
// set through this endpoint. min(1) everywhere: empty strings are rejected,
// null is the explicit "clear this field" signal.
const bodySchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(1).max(5000).nullable(),
    categoryId: z.string().min(1).nullable(),
    thumbnailKey: z.string().min(1).max(500).nullable(),
  })
  .partial();

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const course = await getOwnedCourse(actor, id);
    const data = await parseBody(request, bodySchema);

    // Thumbnail keys must live in this course's own namespace — a key
    // pointing anywhere else (another course, a submission) is rejected.
    if (data.thumbnailKey && !data.thumbnailKey.startsWith(`thumbnails/${course.id}/`)) {
      throw new DomainError("INVALID_KEY", "Invalid thumbnail key");
    }

    if (data.categoryId) {
      const category = await db.category.findUnique({ where: { id: data.categoryId } });
      if (!category) throw new DomainError("UNKNOWN_CATEGORY", "Unknown category");
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.course.update({ where: { id: course.id }, data });
      // Clearing the description must not leave a published course invalid.
      if (course.status === "PUBLISHED" && "description" in data) {
        await assertStillPublishable(tx, course.id);
      }
      return u;
    });

    // Replacing (or clearing) the thumbnail orphans the old object — clean it up.
    if (
      "thumbnailKey" in data &&
      course.thumbnailKey &&
      course.thumbnailKey !== data.thumbnailKey
    ) {
      await deleteObject(course.thumbnailKey);
    }

    return NextResponse.json({ course: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    // forWrite: false — archiving an archived course is a harmless no-op.
    const course = await getOwnedCourse(actor, id, { forWrite: false });

    // Archive, never hard-delete — enrollments and submissions stay intact.
    // Archived courses are read-only until POST /restore.
    const archived = await db.course.update({
      where: { id: course.id },
      data: { status: "ARCHIVED" },
    });
    return NextResponse.json({ course: archived });
  } catch (e) {
    return errorResponse(e);
  }
}
