import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { getOwnedCourse } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";

/** The explicit exit from ARCHIVED — back to a private draft. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const course = await getOwnedCourse(actor, id, { forWrite: false });

    const restored = await db.course.update({
      where: { id: course.id },
      data: { status: "DRAFT" },
    });
    return NextResponse.json({ course: restored });
  } catch (e) {
    return errorResponse(e);
  }
}
