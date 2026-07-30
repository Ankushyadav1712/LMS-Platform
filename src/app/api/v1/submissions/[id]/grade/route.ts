import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { gradeSubmission } from "@/lib/assignments";
import { requireActor } from "@/lib/guards";

const bodySchema = z.object({
  points: z.number().int().min(0).max(1000),
  feedback: z.string().trim().max(20_000).nullish(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const { points, feedback } = await parseBody(request, bodySchema);

    const grade = await gradeSubmission({
      actor,
      submissionId: id,
      points,
      feedback: feedback ?? null,
    });
    return NextResponse.json({ grade }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
