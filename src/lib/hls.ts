// Pure HLS pipeline logic — no IO, fully unit-testable. The worker and the
// playlist-proxy routes are thin shells around these functions.

export type Rendition = {
  name: string; // "720p"
  height: number;
  videoBitrateK: number; // kbps target
  audioBitrateK: number;
  bandwidth: number; // BANDWIDTH attr for the master playlist (bits/s)
};

const LADDER: Rendition[] = [
  { name: "360p", height: 360, videoBitrateK: 800, audioBitrateK: 96, bandwidth: 1_000_000 },
  { name: "720p", height: 720, videoBitrateK: 2800, audioBitrateK: 128, bandwidth: 3_200_000 },
  { name: "1080p", height: 1080, videoBitrateK: 5000, audioBitrateK: 128, bandwidth: 5_600_000 },
];

/**
 * Never upscale: only rungs at or below the source height. Sources smaller
 * than the lowest rung get a single encode at their own height (the rung
 * keeps its ladder name; only the encode size shrinks).
 */
export function pickRenditions(sourceHeight: number): Rendition[] {
  const fitting = LADDER.filter((r) => r.height <= sourceHeight);
  if (fitting.length > 0) return fitting;
  const evenHeight = Math.max(2, Math.floor(sourceHeight / 2) * 2);
  return [{ ...LADDER[0], height: evenHeight }];
}

/**
 * ffmpeg args for one rendition. Keyframe alignment across renditions
 * (-g/-keyint_min + sc_threshold 0) keeps segment boundaries identical so
 * the player can switch quality mid-stream without stutter.
 */
export function ffmpegArgs(opts: {
  inputPath: string;
  outDir: string;
  rendition: Rendition;
  segmentSeconds?: number;
  fps?: number;
}): string[] {
  const seg = opts.segmentSeconds ?? 4;
  const fps = opts.fps ?? 24;
  const gop = seg * fps; // one keyframe per segment boundary
  const r = opts.rendition;
  return [
    "-hide_banner",
    "-y",
    "-i",
    opts.inputPath,
    "-vf",
    `scale=-2:${r.height}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "main",
    "-b:v",
    `${r.videoBitrateK}k`,
    "-maxrate",
    `${Math.round(r.videoBitrateK * 1.1)}k`,
    "-bufsize",
    `${r.videoBitrateK * 2}k`,
    "-r",
    String(fps),
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    `${r.audioBitrateK}k`,
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    String(seg),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    `${opts.outDir}/seg_%04d.ts`,
    `${opts.outDir}/playlist.m3u8`,
  ];
}

/** Master playlist referencing each rendition's media playlist by name. */
export function buildMasterPlaylist(renditions: Rendition[]): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const r of renditions) {
    const width = Math.round((r.height * 16) / 9 / 2) * 2;
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${width}x${r.height},NAME="${r.name}"`,
      `${r.name}/playlist.m3u8`,
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Rewrite a master playlist so each rendition line points at our
 * auth-checked proxy route instead of a relative storage path.
 */
export function rewriteMasterPlaylist(
  content: string,
  renditionUrl: (name: string) => string,
): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      // "720p/playlist.m3u8" -> proxy URL for "720p"
      const name = trimmed.split("/")[0];
      return renditionUrl(name);
    })
    .join("\n");
}

/**
 * Rewrite a media playlist so each segment line becomes a presigned absolute
 * URL. Playlists proxy through the API (tiny, auth-checked); segment bytes
 * stream straight from storage.
 */
export function rewriteMediaPlaylist(
  content: string,
  segmentUrl: (fileName: string) => string,
): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return segmentUrl(trimmed);
    })
    .join("\n");
}

/** Rendition names are path fragments — allow only the shape we generate. */
export function isValidRenditionName(name: string): boolean {
  return /^[0-9]{3,4}p$/.test(name);
}
