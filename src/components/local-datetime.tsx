"use client";

import { useSyncExternalStore } from "react";

function format(iso: string, dateOnly: boolean, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = dateOnly
    ? { year: "numeric", month: "short", day: "numeric" }
    : { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat(undefined, timeZone ? { ...opts, timeZone } : opts).format(
    new Date(iso),
  );
}

const subscribe = () => () => {};

/**
 * Server components can't know the viewer's timezone. useSyncExternalStore
 * renders UTC during SSR/hydration (deterministic — no mismatch), then swaps
 * to the viewer's local zone on the client after hydration.
 */
export function LocalDateTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(iso, dateOnly),
    () => format(iso, dateOnly, "UTC"),
  );
  return <span>{text}</span>;
}
