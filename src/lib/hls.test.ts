import { describe, expect, it } from "vitest";

import {
  buildMasterPlaylist,
  ffmpegArgs,
  isValidRenditionName,
  pickRenditions,
  rewriteMasterPlaylist,
  rewriteMediaPlaylist,
} from "./hls";

describe("pickRenditions", () => {
  it("gives a 1080p source the full ladder", () => {
    expect(pickRenditions(1080).map((r) => r.name)).toEqual(["360p", "720p", "1080p"]);
  });

  it("never upscales a 720p source to 1080p", () => {
    expect(pickRenditions(720).map((r) => r.name)).toEqual(["360p", "720p"]);
  });

  it("keeps 4K sources at the ladder max", () => {
    expect(pickRenditions(2160).map((r) => r.name)).toEqual(["360p", "720p", "1080p"]);
  });

  it("gives tiny sources at least one rung", () => {
    expect(pickRenditions(240).map((r) => r.name)).toEqual(["360p"]);
  });
});

describe("ffmpegArgs", () => {
  const args = ffmpegArgs({
    inputPath: "/tmp/in.mp4",
    outDir: "/tmp/out/720p",
    rendition: pickRenditions(720)[1],
  });

  it("aligns keyframes to segment boundaries", () => {
    const gop = args[args.indexOf("-g") + 1];
    const keyintMin = args[args.indexOf("-keyint_min") + 1];
    const segTime = Number(args[args.indexOf("-hls_time") + 1]);
    const fps = Number(args[args.indexOf("-r") + 1]);
    expect(Number(gop)).toBe(segTime * fps);
    expect(keyintMin).toBe(gop);
    expect(args[args.indexOf("-sc_threshold") + 1]).toBe("0");
  });

  it("writes VOD playlists with the segment template", () => {
    expect(args).toContain("vod");
    expect(args).toContain("/tmp/out/720p/seg_%04d.ts");
    expect(args[args.length - 1]).toBe("/tmp/out/720p/playlist.m3u8");
  });

  it("scales to the rendition height with even width", () => {
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=-2:720");
  });
});

describe("master playlist build + rewrite round-trip", () => {
  const master = buildMasterPlaylist(pickRenditions(1080));

  it("lists every rendition with bandwidth and resolution", () => {
    expect(master).toContain("#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720");
    expect(master).toContain("720p/playlist.m3u8");
    expect(master.startsWith("#EXTM3U")).toBe(true);
  });

  it("rewrites rendition lines to proxy URLs and leaves tags alone", () => {
    const rewritten = rewriteMasterPlaylist(master, (name) => `/api/hls/${name}`);
    expect(rewritten).toContain("/api/hls/720p");
    expect(rewritten).not.toContain("720p/playlist.m3u8");
    expect(rewritten).toContain("#EXT-X-VERSION:3");
  });
});

describe("rewriteMediaPlaylist", () => {
  const media = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:4",
    "#EXTINF:4.000000,",
    "seg_0000.ts",
    "#EXTINF:2.500000,",
    "seg_0001.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");

  it("presigns segment lines and leaves tags/blank lines alone", () => {
    const rewritten = rewriteMediaPlaylist(media, (f) => `https://s3/signed/${f}?sig=x`);
    expect(rewritten).toContain("https://s3/signed/seg_0000.ts?sig=x");
    expect(rewritten).toContain("https://s3/signed/seg_0001.ts?sig=x");
    expect(rewritten).toContain("#EXT-X-TARGETDURATION:4");
    expect(rewritten).toContain("#EXT-X-ENDLIST");
  });
});

describe("isValidRenditionName", () => {
  it.each([
    ["720p", true],
    ["1080p", true],
    ["360p", true],
    ["../../etc", false],
    ["720p/..", false],
    ["720", false],
    ["", false],
  ])("%s -> %s", (name, expected) => {
    expect(isValidRenditionName(name)).toBe(expected);
  });
});
