"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiAction } from "@/lib/use-api-action";

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
  const { pending, error, run } = useApiAction();

  function changeRole(nextRole: string) {
    if (nextRole === role) return;
    run(() =>
      fetch(`/api/v1/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      }),
    );
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
