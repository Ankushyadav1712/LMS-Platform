import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { DomainError } from "@/lib/authz";
import { getOwnedCourse, getPublishBlockers } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    // getOwnedCourse rejects ARCHIVED with 409 — restore is the only way out.
    const course = await getOwnedCourse(actor, id);

    const blockers = await getPublishBlockers(db, course.id);
    if (blockers.length > 0) {
      throw new DomainError("NOT_READY", blockers.join(" · "), { blockers });
    }

    const published = await db.course.update({
      where: { id: course.id },
      data: { status: "PUBLISHED", publishedAt: course.publishedAt ?? new Date() },
    });
    return NextResponse.json({ course: published });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Unpublish — back to draft; enrollments are untouched. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const course = await getOwnedCourse(actor, id);

    const drafted = await db.course.update({
      where: { id: course.id },
      data: { status: "DRAFT" },
    });
    return NextResponse.json({ course: drafted });
  } catch (e) {
    return errorResponse(e);
  }
}
