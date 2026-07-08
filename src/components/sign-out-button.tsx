"use client";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  return (
    <Button
      variant="outline"
      onClick={async () => {
        await authClient.signOut();
        window.location.assign("/");
      }}
    >
      Sign out
    </Button>
  );
}
