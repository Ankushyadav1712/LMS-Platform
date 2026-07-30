import Link from "next/link";

import { NotificationBell } from "@/components/notification-bell";

/**
 * Shared shell header: brand link plus per-page nav content. The
 * notification bell lives here so signed-in users see grade badges on every
 * page (it self-hides when signed out).
 */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="mb-10 flex items-center justify-between">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        LMS Platform
      </Link>
      <nav className="flex items-center gap-4">
        {children}
        <NotificationBell />
      </nav>
    </header>
  );
}
