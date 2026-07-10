import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { can, ForbiddenError } from "@/lib/authz";
import { createCourse } from "@/lib/courses";
import { requireActor } from "@/lib/guards";

const bodySchema = z.object({
  title: z.string().trim().min(3).max(120),
});

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    if (!can.createCourse(actor)) throw new ForbiddenError();
    const { title } = await parseBody(request, bodySchema);

    const course = await createCourse(actor, title);
    return NextResponse.json({ course }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
