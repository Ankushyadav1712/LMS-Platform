import { errorResponse } from "@/lib/api";
import { NotFoundError } from "@/lib/authz";
import { requireActor } from "@/lib/guards";
import { isValidRenditionName, rewriteMediaPlaylist } from "@/lib/hls";
import { getPlayableLecture, playableHlsKey } from "@/lib/playback";
import { getObjectText, presignVideoPlayback } from "@/lib/s3";

/**
 * Media playlists: segment lines become presigned absolute URLs, so the
 * bytes stream straight from storage while every playlist fetch re-checks
 * access. This is the signed-cookie problem solved at the playlist layer —
 * one auth check covers a hundred segment requests.
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

    const rewritten = await rewriteMediaPlaylistSigned(content, prefix, rendition);
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
      signed.set(name, await presignVideoPlayback(`${prefix}${rendition}/${name}`));
    }),
  );
  return rewriteMediaPlaylist(content, (name) => signed.get(name) ?? name);
}
