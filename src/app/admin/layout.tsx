import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { requirePageRole } from "@/lib/guards";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("/admin", "ADMIN");

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <SiteHeader>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Dashboard
        </Link>
        <span className="text-sm font-medium text-foreground">Admin</span>
      </SiteHeader>
      {children}
    </div>
  );
}
