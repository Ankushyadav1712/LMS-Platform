"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiAction } from "@/lib/use-api-action";

export function NewCourseForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const { pending, error, run } = useApiAction();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        fetch("/api/v1/courses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }),
      {
        refresh: false,
        onSuccess: (body: { course: { id: string } }) =>
          router.push(`/teach/courses/${body.course.id}`),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md items-start gap-2">
      <div className="flex-1">
        <Input
          placeholder="New course title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={3}
          aria-label="New course title"
        />
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create course"}
      </Button>
    </form>
  );
}
