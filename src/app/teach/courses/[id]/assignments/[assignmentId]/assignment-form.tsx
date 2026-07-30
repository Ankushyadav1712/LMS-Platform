"use client";

import { useState } from "react";

import { SaveFooter } from "@/components/save-footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApiAction } from "@/lib/use-api-action";

type Assignment = {
  id: string;
  title: string;
  instructions: string;
  rubric: string | null;
  dueAt: string | null;
  maxPoints: number;
  allowLate: boolean;
  maxAttempts: number;
  isPublished: boolean;
};

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AssignmentForm({ assignment }: { assignment: Assignment }) {
  const [form, setForm] = useState({
    title: assignment.title,
    instructions: assignment.instructions,
    rubric: assignment.rubric ?? "",
    dueAt: toLocalInput(assignment.dueAt),
    maxPoints: assignment.maxPoints,
    allowLate: assignment.allowLate,
    maxAttempts: assignment.maxAttempts,
    isPublished: assignment.isPublished,
  });
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useApiAction();

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    run(
      () =>
        fetch(`/api/v1/assignments/${assignment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            instructions: form.instructions,
            rubric: form.rubric.trim() ? form.rubric : null,
            // datetime-local has no zone; treat as local and send ISO/UTC.
            dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
            maxPoints: form.maxPoints,
            allowLate: form.allowLate,
            maxAttempts: form.maxAttempts,
            isPublished: form.isPublished,
          }),
        }),
      { onSuccess: () => setSaved(true) },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignment settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="a-title">Title</Label>
            <Input
              id="a-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required
              minLength={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-instructions">Instructions</Label>
            <Textarea
              id="a-instructions"
              value={form.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              rows={6}
              placeholder="What should students do? (required before publishing)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-rubric">Rubric (optional)</Label>
            <Textarea
              id="a-rubric"
              value={form.rubric}
              onChange={(e) => set("rubric", e.target.value)}
              rows={3}
              placeholder="Grading criteria — also anchors AI-drafted feedback later"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="a-due">Due date</Label>
              <Input
                id="a-due"
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) => set("dueAt", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-points">Max points</Label>
              <Input
                id="a-points"
                type="number"
                min={1}
                max={1000}
                value={form.maxPoints}
                onChange={(e) => set("maxPoints", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-attempts">Max attempts</Label>
              <Input
                id="a-attempts"
                type="number"
                min={1}
                max={20}
                value={form.maxAttempts}
                onChange={(e) => set("maxAttempts", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.allowLate}
                onCheckedChange={(c) => set("allowLate", c === true)}
              />
              Allow late submissions
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.isPublished}
                onCheckedChange={(c) => set("isPublished", c === true)}
              />
              Published
            </label>
          </div>
          <SaveFooter pending={pending} error={error} saved={saved} label="Save assignment" />
        </form>
      </CardContent>
    </Card>
  );
}
