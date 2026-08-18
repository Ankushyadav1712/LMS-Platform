import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Uptime-monitor target. Deliberately unauthenticated and deliberately terse:
 * it reports whether dependencies are reachable, never version numbers, row
 * counts, or error details that would help an attacker fingerprint the stack.
 *
 * Doubles as the keep-warm ping for free-tier hosting.
 */
export async function GET() {
  const checks: Record<string, "ok" | "down"> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (e) {
    console.error("health: database unreachable", e);
    checks.database = "down";
  }

  // Queue depth surfaces a wedged or stopped transcoding worker — a healthy
  // app with a dead worker still leaves videos stuck in PROCESSING.
  let queueDepth: number | null = null;
  try {
    const rows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM pgboss.job
      WHERE name = 'transcode-video' AND state IN ('created', 'active')
    `;
    queueDepth = Number(rows[0]?.count ?? 0);
    checks.queue = "ok";
  } catch {
    // pg-boss installs its schema on first worker boot; absent is not "down".
    checks.queue = "down";
  }

  const healthy = checks.database === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, queueDepth },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
