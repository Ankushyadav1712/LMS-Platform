import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/session";

// The real auth boundary: proxy.ts only checks cookie presence.
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard");

  const { user } = session;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <header className="mb-12 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          LMS Platform
        </Link>
        <SignOutButton />
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>{user.name}</CardTitle>
            <Badge variant="secondary">{user.role}</Badge>
          </div>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Signed in with a database-backed session that expires{" "}
          {session.session.expiresAt.toLocaleDateString()}. Role-specific dashboards land in Week 3.
        </CardContent>
      </Card>
    </div>
  );
}
