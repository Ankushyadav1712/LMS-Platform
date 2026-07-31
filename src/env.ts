import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Boot-time env validation: a missing or malformed variable fails loudly at
// startup instead of surfacing as a runtime error mid-request.
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().optional(),
    // Google OAuth is optional: the login page hides the button when unset.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Object storage (MinIO locally, Cloudflare R2 in production).
    // Required since Week 4 — thumbnails/attachments upload via presigned URLs.
    S3_ENDPOINT: z.url(),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_REGION: z.string().min(1),
    // AI-assisted grading is optional: without a key the feature is simply
    // unavailable (the API returns 503 and the UI hides the button).
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_GRADING_MODEL: z.string().default("claude-opus-5"),
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_GRADING_MODEL: process.env.AI_GRADING_MODEL,
  },
  emptyStringAsUndefined: true,
});
