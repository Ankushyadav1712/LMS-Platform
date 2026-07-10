"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useApiAction } from "@/lib/use-api-action";

type Lecture = { id: string; title: string; position: number; isPublished: boolean };
type Section = {
  id: string;
  title: string;
  position: number;
  isPublished: boolean;
  lectures: Lecture[];
};

export function Curriculum({ courseId, sections }: { courseId: string; sections: Section[] }) {
  const { pending, error, run } = useApiAction();

  function addSection(title: string, onSuccess: () => void) {
    run(
      () =>
        fetch(`/api/v1/courses/${courseId}/sections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }),
      { onSuccess },
    );
  }

  function addLecture(sectionId: string, title: string, onSuccess: () => void) {
    run(
      () =>
        fetch(`/api/v1/sections/${sectionId}/lectures`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }),
      { onSuccess },
    );
  }

  function toggleSection(sectionId: string, isPublished: boolean) {
    run(() =>
      fetch(`/api/v1/sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished }),
      }),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Curriculum</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sections yet — add the first one.</p>
        ) : (
          sections.map((section) => (
            <div key={section.id} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">
                  {section.position}. {section.title}
                </p>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Published
                  <Switch
                    checked={section.isPublished}
                    onCheckedChange={(checked) => toggleSection(section.id, checked === true)}
                    disabled={pending}
                  />
                </label>
              </div>
              <ul className="space-y-1">
                {section.lectures.map((lecture) => (
                  <li key={lecture.id}>
                    <Link
                      href={`/teach/courses/${courseId}/lectures/${lecture.id}`}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    >
                      <span>
                        {section.position}.{lecture.position} {lecture.title}
                      </span>
                      <Badge variant={lecture.isPublished ? "default" : "secondary"}>
                        {lecture.isPublished ? "Published" : "Draft"}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
              <InlineAdd
                placeholder="New lecture title…"
                cta="Add lecture"
                disabled={pending}
                onAdd={(title, clear) => addLecture(section.id, title, clear)}
              />
              <Separator />
            </div>
          ))
        )}
        <InlineAdd
          placeholder="New section title…"
          cta="Add section"
          disabled={pending}
          onAdd={(title, clear) => addSection(title, clear)}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function InlineAdd({
  placeholder,
  cta,
  disabled,
  onAdd,
}: {
  placeholder: string;
  cta: string;
  disabled: boolean;
  // The input clears only via the success callback — a failed request keeps
  // the typed title so it isn't lost.
  onAdd: (title: string, clear: () => void) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onAdd(value.trim(), () => setValue(""));
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <Button type="submit" variant="outline" size="sm" disabled={disabled}>
        {cta}
      </Button>
    </form>
  );
}
