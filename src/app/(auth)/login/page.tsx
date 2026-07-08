import Link from "next/link";

import { env } from "@/env";

import { LoginForm } from "./login-form";

// Only same-site paths: a raw ?next= value would be an open-redirect vector.
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back. Enter your details to continue.
        </p>
      </div>
      <LoginForm
        next={safeNext(next)}
        googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      />
      <p className="text-sm text-muted-foreground">
        No account yet?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Sign up
        </Link>
      </p>
    </div>
  );
}
