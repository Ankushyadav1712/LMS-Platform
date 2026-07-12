import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { getOwnedLecture } from "@/lib/courses";
import { requireActor } from "@/lib/guards";

/** Owner-only poll target while a transcode is in flight. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const lecture = await getOwnedLecture(actor, id, { forWrite: false });
    return NextResponse.json({
      videoStatus: lecture.videoStatus,
      durationSeconds: lecture.durationSeconds,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
