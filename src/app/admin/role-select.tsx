"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLES = ["STUDENT", "INSTRUCTOR", "ADMIN"] as const;

export function RoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function changeRole(nextRole: string) {
    if (nextRole === role) return;
    // Async transition (React 19): pending covers the whole mutation, so the
    // select stays disabled from PATCH start through refresh — no racing a
    // second role change while one is in flight.
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/v1/admin/users/${userId}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error?.message ?? "Failed to update role");
          return;
        }
        router.refresh();
      } catch {
        setError("Network error — role was not updated");
      }
    });
  }

  return (
    <div>
      <Select
        value={role}
        onValueChange={(value) => changeRole(String(value))}
        disabled={disabled || pending}
      >
        <SelectTrigger className="w-[150px]" aria-label="Role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
