import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/guards";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enrollStudent } from "@/lib/learn";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    await enforceRateLimit(actor.id, "enroll");
    const { id } = await params;

    const { enrollment, created } = await enrollStudent(actor, id);
    return NextResponse.json({ enrollment }, { status: created ? 201 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}
