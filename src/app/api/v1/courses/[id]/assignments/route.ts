import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { getOwnedCourse } from "@/lib/courses";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";

const bodySchema = z.object({
  title: z.string().trim().min(3).max(160),
});

// Create a draft assignment on a course (owner only).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const course = await getOwnedCourse(actor, id);
    const { title } = await parseBody(request, bodySchema);

    const assignment = await db.assignment.create({
      data: { courseId: course.id, title, instructions: "" },
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
