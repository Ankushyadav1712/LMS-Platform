import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api";
import { DomainError } from "@/lib/authz";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { getPlayableLecture, playableHlsKey } from "@/lib/playback";
import { presignVideoPlayback } from "@/lib/s3";

/**
 * Returns what to play and how: adaptive HLS via the auth-checked playlist
 * proxy when a transcoded build exists, or the raw MP4 via a signed URL as
 * fallback. Content protection is access control, not DRM.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const { lecture } = await getPlayableLecture(actor, id);

    const progress = await db.lectureProgress.findUnique({
      where: { studentId_lectureId: { studentId: actor.id, lectureId: lecture.id } },
      select: { lastWatchedSecond: true, isCompleted: true },
    });
    const base = {
      durationSeconds: lecture.durationSeconds,
      resumeAt: progress?.lastWatchedSecond ?? 0,
      isCompleted: progress?.isCompleted ?? false,
    };

    const hlsKey = playableHlsKey(lecture);
    if (hlsKey) {
      return NextResponse.json({
        kind: "hls",
        url: `/api/v1/lectures/${lecture.id}/hls/master`,
        ...base,
      });
    }
    if (lecture.videoStatus === "READY" && lecture.videoKey) {
      return NextResponse.json({
        kind: "mp4",
        url: await presignVideoPlayback(lecture.videoKey),
        ...base,
      });
    }
    throw new DomainError("NO_VIDEO", "This lecture has no playable video", undefined, 409);
  } catch (e) {
    return errorResponse(e);
  }
}
