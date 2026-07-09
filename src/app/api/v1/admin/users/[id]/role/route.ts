import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { errorResponse, parseBody } from "@/lib/api";
import { can, ForbiddenError, NotFoundError } from "@/lib/authz";
import { requireRole } from "@/lib/guards";
import { db } from "@/lib/db";

// Dedicated endpoint for role changes — role is never accepted on any
// generic user-update payload (mass-assignment guard).
const bodySchema = z.object({
  role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("ADMIN");
    const { id } = await params;
    const { role } = await parseBody(request, bodySchema);

    if (!can.changeRole(actor, { id })) {
      throw new ForbiddenError("You cannot change your own role");
    }

    // Single atomic update — no read-then-write race. A vanished target
    // surfaces as Prisma P2025, mapped to the domain 404.
    try {
      const user = await db.user.update({
        where: { id },
        data: { role },
        select: { id: true, name: true, email: true, role: true },
      });
      return NextResponse.json({ user });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        throw new NotFoundError("User not found");
      }
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
