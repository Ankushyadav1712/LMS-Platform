import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Boot-time env validation: a missing or malformed variable fails loudly at
// startup instead of surfacing as a runtime error mid-request.
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    // Object storage (MinIO locally, Cloudflare R2 in production).
    // Optional until the upload flows land in Week 4, then flip to required.
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
  },
  emptyStringAsUndefined: true,
});
