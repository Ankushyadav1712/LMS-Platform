import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { requireActor } from "@/lib/guards";
import { markRead } from "@/lib/notifications";

const bodySchema = z.object({ id: z.string().min(1).optional() });

// Mark one (by id) or all of the caller's notifications read.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const { id } = await parseBody(request, bodySchema);
    const updated = await markRead(actor.id, id);
    return NextResponse.json({ updated });
  } catch (e) {
    return errorResponse(e);
  }
}
