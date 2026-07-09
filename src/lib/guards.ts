import { redirect } from "next/navigation";

import { ForbiddenError, UnauthorizedError, type Actor, type Role } from "@/lib/authz";
import { getSession, type SessionUser } from "@/lib/session";

// Session guards for route handlers (throw) and pages (redirect).
// Kept separate from the pure policy layer in authz.ts.

export function toActor(user: SessionUser): Actor {
  return { id: user.id, role: user.role as Role };
}

/** Route handlers: current actor or 401. */
export async function requireActor(): Promise<Actor> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return toActor(session.user);
}

/** Route handlers: current actor with one of the given roles, or 401/403. */
export async function requireRole(...roles: Role[]): Promise<Actor> {
  const actor = await requireActor();
  if (!roles.includes(actor.role)) throw new ForbiddenError();
  return actor;
}

/** Pages/layouts: redirect instead of throwing. */
export async function requirePageRole(next: string, ...roles: Role[]): Promise<Actor> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  const actor = toActor(session.user);
  if (!roles.includes(actor.role)) redirect("/dashboard");
  return actor;
}
