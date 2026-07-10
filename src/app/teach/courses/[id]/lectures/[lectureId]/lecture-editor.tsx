"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApiAction } from "@/lib/use-api-action";

export function LectureEditor({
  lecture,
}: {
  lecture: {
    id: string;
    title: string;
    body: string | null;
    isPublished: boolean;
    isFreePreview: boolean;
  };
}) {
  const [title, setTitle] = useState(lecture.title);
  const [body, setBody] = useState(lecture.body ?? "");
  const [isPublished, setIsPublished] = useState(lecture.isPublished);
  const [isFreePreview, setIsFreePreview] = useState(lecture.isFreePreview);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useApiAction();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    run(
      () =>
        fetch(`/api/v1/lectures/${lecture.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body: body.trim() ? body : null,
            isPublished,
            isFreePreview,
          }),
        }),
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lecture-title">Title</Label>
            <Input
              id="lecture-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lecture-body">Content (Markdown)</Label>
            <Textarea
              id="lecture-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              placeholder="Write the lecture content…"
            />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isPublished} onCheckedChange={(c) => setIsPublished(c === true)} />
              Published
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={isFreePreview}
                onCheckedChange={(c) => setIsFreePreview(c === true)}
              />
              Free preview
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save lecture"}
            </Button>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : saved ? (
              <p className="text-sm text-muted-foreground">Saved</p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
