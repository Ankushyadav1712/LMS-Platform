"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionError, useApiAction } from "@/lib/use-api-action";

export function ThumbnailUpload({
  courseId,
  thumbnailUrl,
}: {
  courseId: string;
  thumbnailUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending, error, run } = useApiAction();

  function onFileChosen(file: File | undefined) {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";

    run(async () => {
      // 1. Ask the API to approve this exact upload (type + size are signed).
      const presign = await fetch("/api/v1/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "course-thumbnail",
          courseId,
          contentType: file.type,
          contentLength: file.size,
        }),
      });
      const presignBody = await presign.json().catch(() => null);
      if (!presign.ok) {
        throw new ActionError(presignBody?.error?.message ?? "Upload not allowed");
      }

      // 2. Upload the bytes straight to object storage — not via our API.
      const put = await fetch(presignBody.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new ActionError("Upload to storage failed");

      // 3. Point the course at the new key (server deletes the old object).
      return fetch(`/api/v1/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnailKey: presignBody.key }),
      });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cover image</CardTitle>
        <CardDescription>JPEG, PNG or WebP, up to 5MB.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {thumbnailUrl ? (
          // Presigned URL is memoized server-side — plain <img> keeps the
          // browser cache effective without image-optimizer churn.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt="Course cover"
            className="aspect-video w-full rounded-lg border object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No cover yet
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => onFileChosen(e.target.files?.[0])}
        />
        <Button
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? "Uploading…" : thumbnailUrl ? "Replace image" : "Upload image"}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
