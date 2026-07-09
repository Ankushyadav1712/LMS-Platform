import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/sign-out-button";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { toActor } from "@/lib/guards";
import { getSession } from "@/lib/session";

// The real auth boundary: proxy.ts only checks cookie presence.
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard");

  const { user } = session;
  const actor = toActor(user);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <SiteHeader>
        {can.createCourse(actor) ? (
          <Link href="/teach" className="text-sm text-muted-foreground hover:text-foreground">
            Teach
          </Link>
        ) : null}
        {can.administrate(actor) ? (
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            Admin
          </Link>
        ) : null}
        <SignOutButton />
      </SiteHeader>

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
          {session.session.expiresAt.toLocaleDateString()}. Enrollments and progress land in Week 5.
        </CardContent>
      </Card>
    </div>
  );
}
