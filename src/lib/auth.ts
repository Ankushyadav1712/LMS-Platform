import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { env } from "@/env";
import { db } from "@/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  user: {
    additionalFields: {
      // input: false — role can never be set from a signup/update payload.
      // Promotion happens only through the admin flow (Week 3).
      role: {
        type: "string",
        defaultValue: "STUDENT",
        input: false,
      },
    },
  },
  session: {
    // DB-backed sessions with sliding expiration: 30-day lifetime,
    // refreshed at most once a day on activity.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  // Must stay last: lets server actions set auth cookies via next/headers.
  plugins: [nextCookies()],
});
