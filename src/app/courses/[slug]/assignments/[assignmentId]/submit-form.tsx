"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ActionError, useApiAction } from "@/lib/use-api-action";

export function SubmitForm({
  assignmentId,
  canSubmit,
  willBeLate,
  closedReason,
  attemptsLeft,
}: {
  assignmentId: string;
  canSubmit: boolean;
  willBeLate: boolean;
  closedReason: string | null;
  attemptsLeft: number;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pending, error, run } = useApiAction();

  if (!canSubmit) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-sm text-muted-foreground">
          Submissions are closed: {closedReason ?? "no attempts remaining"}.
        </CardContent>
      </Card>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !file) return;

    run(
      async () => {
        let fileKey: string | null = null;

        // Optional file: presign → PUT direct to storage → send the key.
        if (file) {
          const presign = await fetch("/api/v1/uploads/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              purpose: "submission-file",
              assignmentId,
              contentType: file.type,
              contentLength: file.size,
            }),
          });
          const presignBody = await presign.json().catch(() => null);
          if (!presign.ok)
            throw new ActionError(presignBody?.error?.message ?? "Upload not allowed");

          const put = await fetch(presignBody.url, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!put.ok) throw new ActionError("Upload to storage failed");
          fileKey = presignBody.key;
        }

        return fetch(`/api/v1/assignments/${assignmentId}/submissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ textContent: text.trim() || null, fileKey }),
        });
      },
      {
        onSuccess: () => {
          setText("");
          setFile(null);
          if (fileRef.current) fileRef.current.value = "";
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Submit {willBeLate ? <span className="text-destructive">(late)</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Type your answer, and/or attach a file below…"
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,application/zip,image/png,image/jpeg,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || (!text.trim() && !file)}>
              {pending ? "Submitting…" : "Submit attempt"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} left
            </span>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
