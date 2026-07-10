"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type Phase = "idle" | "uploading" | "confirming";

/** Reads the duration off the file locally so the server can store it. */
function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(el.src);
      resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : undefined);
    };
    el.onerror = () => resolve(undefined);
    el.src = URL.createObjectURL(file);
  });
}

/** XHR instead of fetch: upload progress events for the bar. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage rejected the upload (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function VideoUpload({
  lectureId,
  videoStatus,
  durationSeconds,
}: {
  lectureId: string;
  videoStatus: string;
  durationSeconds: number | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const hasVideo = videoStatus === "READY";

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";
    setError(null);
    setPercent(0);
    setPhase("uploading");
    try {
      const duration = await readDuration(file);

      const presign = await fetch("/api/v1/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "lecture-video",
          lectureId,
          contentType: file.type,
          contentLength: file.size,
        }),
      });
      const presignBody = await presign.json().catch(() => null);
      if (!presign.ok) {
        throw new Error(presignBody?.error?.message ?? "Upload not allowed");
      }

      await putWithProgress(presignBody.url, file, setPercent);

      setPhase("confirming");
      const confirm = await fetch(`/api/v1/lectures/${lectureId}/video/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: presignBody.key, durationSeconds: duration }),
      });
      if (!confirm.ok) {
        const body = await confirm.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Could not attach the video");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Video</CardTitle>
        <CardDescription>
          {hasVideo
            ? `Attached · ${durationSeconds ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s` : "duration unknown"} — uploading again replaces it.`
            : "MP4 or WebM, up to 2GB. Uploads go straight to storage, not through the app server."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {phase === "uploading" ? (
          <div className="space-y-2">
            <Progress value={percent} />
            <p className="text-sm text-muted-foreground">Uploading… {percent}%</p>
          </div>
        ) : phase === "confirming" ? (
          <p className="text-sm text-muted-foreground">Finalizing…</p>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm"
          className="hidden"
          onChange={(e) => onFileChosen(e.target.files?.[0])}
        />
        <Button
          variant="outline"
          className="w-full"
          disabled={phase !== "idle"}
          onClick={() => inputRef.current?.click()}
        >
          {hasVideo ? "Replace video" : "Upload video"}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
