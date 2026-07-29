import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { DomainError } from "@/lib/authz";
import { getOwnedAssignment } from "@/lib/assignments";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";

// Explicit allowlist — courseId, submissions, etc. can never be set here.
const bodySchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    instructions: z.string().trim().max(20_000),
    rubric: z.string().trim().max(10_000).nullable(),
    dueAt: z.iso.datetime().nullable(),
    maxPoints: z.number().int().min(1).max(1000),
    allowLate: z.boolean(),
    maxAttempts: z.number().int().min(1).max(20),
    isPublished: z.boolean(),
  })
  .partial();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const assignment = await getOwnedAssignment(actor, id);
    const data = await parseBody(request, bodySchema);

    // Publishing requires real instructions — an empty brief helps no one.
    const willPublish = data.isPublished ?? assignment.isPublished;
    const instructions = data.instructions ?? assignment.instructions;
    if (willPublish && !instructions.trim()) {
      throw new DomainError("NOT_READY", "Add instructions before publishing");
    }

    const updated = await db.assignment.update({
      where: { id: assignment.id },
      data: {
        ...data,
        dueAt: data.dueAt === undefined ? undefined : data.dueAt ? new Date(data.dueAt) : null,
      },
    });
    return NextResponse.json({ assignment: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
