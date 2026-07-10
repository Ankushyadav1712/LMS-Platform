"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Throw inside a run() callback to surface a custom message (multi-step flows). */
export class ActionError extends Error {}

type ErrorEnvelope = { error?: { message?: string; [key: string]: unknown } } | null;

/**
 * The one client-side mutation pattern: transition-wrapped fetch, envelope
 * parsing, error surfacing, router.refresh on success. `pending` covers the
 * whole operation, so callers can disable controls for its full duration.
 */
export function useApiAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    fn: () => Promise<Response>,
    opts: {
      refresh?: boolean;
      onSuccess?: (body: never) => void;
      onError?: (body: ErrorEnvelope) => void;
    } = {},
  ) {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fn();
        const body = (await res.json().catch(() => null)) as ErrorEnvelope;
        if (!res.ok) {
          setError(body?.error?.message ?? "Something went wrong");
          opts.onError?.(body);
          return;
        }
        if (opts.refresh !== false) router.refresh();
        opts.onSuccess?.(body as never);
      } catch (e) {
        setError(e instanceof ActionError ? e.message : "Network error — nothing was changed");
      }
    });
  }

  return { pending, error, setError, run };
}
