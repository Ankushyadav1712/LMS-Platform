import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, parseBody } from "@/lib/api";
import { getOwnedAssignment, getSubmittableAssignment, submitAttempt } from "@/lib/assignments";
import { DomainError } from "@/lib/authz";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/guards";
import { enforceRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  textContent: z.string().trim().max(50_000).nullish(),
  fileKey: z.string().max(500).nullish(),
});

type Params = { params: Promise<{ id: string }> };

// Student submits an attempt.
export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    await enforceRateLimit(actor.id, "submit");
    const { id } = await params;
    const body = await parseBody(request, bodySchema);

    // The submitted file must live in this student's own submission namespace.
    if (body.fileKey && !body.fileKey.startsWith(`submissions/${id}/${actor.id}/`)) {
      throw new DomainError("INVALID_KEY", "File does not belong to this submission");
    }

    const submission = await submitAttempt({
      actor,
      assignmentId: id,
      now: new Date(),
      textContent: body.textContent ?? null,
      fileKey: body.fileKey ?? null,
    });
    return NextResponse.json({ submission }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

// Instructor grading queue (owner) — the student's own attempts otherwise.
export async function GET(request: Request, { params }: Params) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    // Try as owner first; fall back to the student's own view.
    let isOwner = true;
    try {
      await getOwnedAssignment(actor, id);
    } catch {
      isOwner = false;
    }

    if (isOwner) {
      const submissions = await db.submission.findMany({
        where: { assignmentId: id },
        include: {
          student: { select: { id: true, name: true, email: true } },
          grades: { orderBy: { gradedAt: "desc" }, take: 1 },
        },
        orderBy: [{ studentId: "asc" }, { attemptNumber: "desc" }],
      });
      return NextResponse.json({ submissions, view: "instructor" });
    }

    await getSubmittableAssignment(actor, id); // 404 if not a participant
    const submissions = await db.submission.findMany({
      where: { assignmentId: id, studentId: actor.id },
      include: { grades: { orderBy: { gradedAt: "desc" }, take: 1 } },
      orderBy: { attemptNumber: "desc" },
    });
    return NextResponse.json({ submissions, view: "student" });
  } catch (e) {
    return errorResponse(e);
  }
}
