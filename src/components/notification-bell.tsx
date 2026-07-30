"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Lightweight bell: polls the unread count and links to /notifications.
// Self-hides when unauthenticated (the count endpoint 401s). No websockets —
// polling is honest and enough at this scale.
export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch("/api/v1/notifications?count=1");
        if (res.status === 401) {
          if (active) setCount(null); // signed out — hide the bell
          return;
        }
        if (!res.ok) return; // transient 5xx/403 — keep the last known count
        const body = await res.json();
        if (active) setCount(body.unreadCount ?? 0);
      } catch {
        // network error — keep the last known count
      }
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (count === null) return null;

  return (
    <Link
      href="/notifications"
      aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
      className="relative text-sm text-muted-foreground hover:text-foreground"
    >
      <span aria-hidden>🔔</span>
      {count > 0 ? (
        <span className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}
