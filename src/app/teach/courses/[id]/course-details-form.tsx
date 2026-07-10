"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useApiAction } from "@/lib/use-api-action";

const NO_CATEGORY = "__none__";

export function CourseDetailsForm({
  course,
  categories,
}: {
  course: { id: string; title: string; description: string | null; categoryId: string | null };
  categories: { id: string; name: string }[];
}) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? "");
  const [categoryId, setCategoryId] = useState(course.categoryId ?? NO_CATEGORY);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useApiAction();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    run(
      () =>
        fetch(`/api/v1/courses/${course.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description: description.trim() ? description : null,
            categoryId: categoryId === NO_CATEGORY ? null : categoryId,
          }),
        }),
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Course details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="course-title">Title</Label>
            <Input
              id="course-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-description">Description</Label>
            <Textarea
              id="course-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="What will students learn? (required before publishing)"
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(String(v))}>
              <SelectTrigger className="w-full max-w-xs" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save details"}
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
