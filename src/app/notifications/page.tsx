import { redirect } from "next/navigation";

import { LocalDateTime } from "@/components/local-datetime";
import { NotificationsList } from "@/components/notifications-list";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent } from "@/components/ui/card";
import { toActor } from "@/lib/guards";
import { listNotifications } from "@/lib/notifications";
import { getSession } from "@/lib/session";

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/notifications");
  const actor = toActor(session.user);

  const notifications = await listNotifications(actor.id);
  const hasUnread = notifications.some((n) => n.readAt === null);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <SiteHeader>
        <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </a>
      </SiteHeader>

      <NotificationsList hasUnread={hasUnread} />

      {notifications.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">
            No notifications yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const p = n.payload as {
              courseSlug: string;
              assignmentId: string;
              assignmentTitle: string;
              points: number;
              maxPoints: number;
            };
            return (
              <li key={n.id}>
                <a
                  href={`/courses/${p.courseSlug}/assignments/${p.assignmentId}`}
                  className={`block rounded-lg border px-4 py-3 text-sm hover:bg-muted ${
                    n.readAt === null ? "border-foreground/30 bg-muted/40" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      Your submission for <strong>{p.assignmentTitle}</strong> was graded:{" "}
                      {p.points}/{p.maxPoints}
                    </span>
                    {n.readAt === null ? (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-destructive"
                        aria-label="unread"
                      />
                    ) : null}
                  </div>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    <LocalDateTime iso={n.createdAt.toISOString()} />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
