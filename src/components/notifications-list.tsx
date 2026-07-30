"use client";

import { Button } from "@/components/ui/button";
import { useApiAction } from "@/lib/use-api-action";

// "Mark all read" control for the notifications page. Kept as a client
// island so the page itself stays a server component.
export function NotificationsList({ hasUnread }: { hasUnread: boolean }) {
  const { pending, run } = useApiAction();

  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      {hasUnread ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() =>
              fetch("/api/v1/notifications/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              }),
            )
          }
        >
          {pending ? "Marking…" : "Mark all read"}
        </Button>
      ) : null}
    </div>
  );
}
