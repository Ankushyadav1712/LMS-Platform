import { NextResponse } from "next/server";
import { z } from "zod";

import { DomainError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/authz";

type KnownError = UnauthorizedError | ForbiddenError | NotFoundError;

function isKnownError(e: unknown): e is KnownError {
  return (
    e instanceof UnauthorizedError || e instanceof ForbiddenError || e instanceof NotFoundError
  );
}

/** Uniform error envelope: { error: { code, message, ...details } }. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof DomainError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message, ...(e.details ?? {}) } },
      { status: e.status },
    );
  }
  if (isKnownError(e)) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: z.prettifyError(e) } },
      { status: 400 },
    );
  }
  console.error(e);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong" } },
    { status: 500 },
  );
}

/** Zod-parse a JSON body; throws ZodError (→ 400) on mismatch. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await request.json().catch(() => {
    throw new z.ZodError([
      { code: "custom", message: "Request body must be valid JSON", path: [], input: undefined },
    ]);
  });
  return schema.parse(raw);
}
