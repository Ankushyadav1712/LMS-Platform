"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useApiAction } from "@/lib/use-api-action";

export function EnrollButton({ courseId, slug }: { courseId: string; slug: string }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();

  function enroll() {
    run(() => fetch(`/api/v1/courses/${courseId}/enroll`, { method: "POST" }), {
      onError: (body) => {
        // Logged-out visitors: send them to login and bring them back here.
        if (body?.error?.code === "UNAUTHORIZED") {
          router.push(`/login?next=${encodeURIComponent(`/courses/${slug}`)}`);
        }
      },
    });
  }

  return (
    <div className="space-y-2">
      <Button size="lg" onClick={enroll} disabled={pending} className="w-full sm:w-auto">
        {pending ? "Enrolling…" : "Enroll for free"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
