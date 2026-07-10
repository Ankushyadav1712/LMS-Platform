import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { createLectureAtEnd, getOwnedSection } from "@/lib/courses";
import { requireActor } from "@/lib/guards";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const section = await getOwnedSection(actor, id);
    const { title } = await parseBody(request, bodySchema);

    const lecture = await createLectureAtEnd(section.id, title);
    return NextResponse.json({ lecture }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
