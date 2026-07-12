import { errorResponse } from "@/lib/api";
import { NotFoundError } from "@/lib/authz";
import { requireActor } from "@/lib/guards";
import { rewriteMasterPlaylist } from "@/lib/hls";
import { getPlayableLecture, playableHlsKey } from "@/lib/playback";
import { getObjectText } from "@/lib/s3";

/**
 * Playlists proxy through the API — tiny text files, auth-checked on every
 * request. Rendition lines are rewritten to the sibling proxy route, so the
 * player never sees a raw storage path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const { lecture } = await getPlayableLecture(actor, id);

    const masterKey = playableHlsKey(lecture);
    if (!masterKey) throw new NotFoundError("No HLS build for this lecture");

    const content = await getObjectText(masterKey);
    const rewritten = rewriteMasterPlaylist(
      content,
      (name) => `/api/v1/lectures/${lecture.id}/hls/${name}`,
    );

    return new Response(rewritten, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
