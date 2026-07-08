import { headers } from "next/headers";

import { auth } from "@/lib/auth";

/** Current session (or null) for server components and route handlers. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export type SessionData = NonNullable<Awaited<ReturnType<typeof getSession>>>;
export type SessionUser = SessionData["user"];
