import { errorResponse } from "@/lib/api";
import { NotFoundError } from "@/lib/authz";
import { requireActor } from "@/lib/guards";
import { isValidRenditionName, rewriteMediaPlaylist } from "@/lib/hls";
import { getPlayableLecture, playableHlsKey } from "@/lib/playback";
import { getObjectText, playbackTtlSeconds, presignVideoPlayback } from "@/lib/s3";

/**
 * Media playlists: segment lines become presigned absolute URLs, so the
 * bytes stream straight from storage while every PLAYLIST fetch re-checks
 * access. Honest limits: minted segment URLs are bearer tokens valid until
 * their TTL (sized to the lecture's watch session) — un-publishing cuts off
 * playlist fetches immediately, but already-minted segment URLs live out
 * their TTL. Access control, not DRM; the CDN-signed-cookie upgrade path
 * is documented in the plan.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; rendition: string }> },
) {
  try {
    const actor = await requireActor();
    const { id, rendition } = await params;
    // Rendition names are path fragments — reject anything we didn't generate.
    if (!isValidRenditionName(rendition)) throw new NotFoundError("Unknown rendition");

    const { lecture } = await getPlayableLecture(actor, id);
    const masterKey = playableHlsKey(lecture);
    if (!masterKey) throw new NotFoundError("No HLS build for this lecture");

    const prefix = masterKey.replace(/master\.m3u8$/, "");
    const content = await getObjectText(`${prefix}${rendition}/playlist.m3u8`);

    const ttl = playbackTtlSeconds(lecture.durationSeconds);
    const rewritten = await rewriteMediaPlaylistSigned(content, prefix, rendition, ttl);
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

async function rewriteMediaPlaylistSigned(
  content: string,
  prefix: string,
  rendition: string,
  ttlSeconds: number,
): Promise<string> {
  // Presign every segment up front (local HMAC math — microseconds each),
  // then substitute synchronously.
  const segmentNames = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const signed = new Map<string, string>();
  await Promise.all(
    segmentNames.map(async (name) => {
      signed.set(name, await presignVideoPlayback(`${prefix}${rendition}/${name}`, ttlSeconds));
    }),
  );
  return rewriteMediaPlaylist(content, (name) => signed.get(name) ?? name);
}
