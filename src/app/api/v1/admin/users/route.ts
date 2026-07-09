import { NextResponse, type NextRequest } from "next/server";

import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/guards";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    await requireRole("ADMIN");

    const query = request.nextUrl.searchParams.get("query")?.trim();
    const users = await db.user.findMany({
      where: query
        ? {
            OR: [
              { email: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
            ],
          }
        : undefined,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    return NextResponse.json({ users });
  } catch (e) {
    return errorResponse(e);
  }
}
