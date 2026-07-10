"use client";

import { useEffect, useRef, useState } from "react";

const HEARTBEAT_SECONDS = 10;
const COMPLETE_AT = 0.9;

type Playback = {
  url: string;
  resumeAt: number;
  durationSeconds: number | null;
  isCompleted: boolean;
};

export function VideoPlayer({ lectureId, enrolled }: { lectureId: string; enrolled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const completedRef = useRef(false);
  const lastSentRef = useRef(0);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/lectures/${lectureId}/playback`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Playback unavailable");
        if (!cancelled) {
          completedRef.current = body.isCompleted;
          setPlayback(body);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Playback failed"));
    return () => {
      cancelled = true;
    };
  }, [lectureId]);

  // Resume where the student left off — unless they had nearly finished.
  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video || !playback) return;
    const duration = video.duration;
    if (playback.resumeAt > 5 && Number.isFinite(duration) && playback.resumeAt < duration * 0.95) {
      video.currentTime = playback.resumeAt;
    }
  }

  function sendProgress(data: { lastWatchedSecond?: number; isCompleted?: boolean }) {
    if (!enrolled) return; // previews play, but don't track
    void fetch(`/api/v1/lectures/${lectureId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true, // survives tab close for the final flush
    }).catch(() => {});
  }

  function flushPosition() {
    const video = videoRef.current;
    if (!video) return;
    const second = Math.floor(video.currentTime);
    if (second !== lastSentRef.current) {
      lastSentRef.current = second;
      sendProgress({ lastWatchedSecond: second });
    }
  }

  // Heartbeat while playing; flush on pause/unmount.
  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) flushPosition();
    }, HEARTBEAT_SECONDS * 1000);
    return () => {
      clearInterval(interval);
      flushPosition();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback?.url]);

  function onTimeUpdate() {
    const video = videoRef.current;
    if (!video || completedRef.current || !enrolled) return;
    if (Number.isFinite(video.duration) && video.currentTime >= video.duration * COMPLETE_AT) {
      completedRef.current = true;
      sendProgress({ isCompleted: true, lastWatchedSecond: Math.floor(video.currentTime) });
    }
  }

  if (error) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  if (!playback) {
    return <div className="aspect-video w-full animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <video
      ref={videoRef}
      src={playback.url}
      controls
      playsInline
      className="aspect-video w-full rounded-xl border bg-black"
      onLoadedMetadata={onLoadedMetadata}
      onPause={flushPosition}
      onTimeUpdate={onTimeUpdate}
      onEnded={() => {
        flushPosition();
        if (!completedRef.current && enrolled) {
          completedRef.current = true;
          sendProgress({ isCompleted: true });
        }
      }}
    />
  );
}
