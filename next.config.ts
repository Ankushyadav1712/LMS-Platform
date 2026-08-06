import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy. Next needs 'unsafe-inline' for its injected styles,
 * and dev additionally needs 'unsafe-eval' for React Refresh — so the dev and
 * prod policies deliberately differ rather than loosening prod to match dev.
 *
 * media-src/img-src include the object-storage origin because HLS segments and
 * thumbnails are fetched directly from presigned storage URLs.
 */
function contentSecurityPolicy(): string {
  const storageOrigin = process.env.S3_ENDPOINT ?? "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${storageOrigin}`.trim(),
    `media-src 'self' blob: ${storageOrigin}`.trim(),
    `connect-src 'self' ${storageOrigin}`.trim(),
    "font-src 'self' data:",
    // No plugins, no <base> hijacking, and never framed by another site.
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  // Defense in depth alongside frame-ancestors, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak course/submission paths to third parties via Referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Don't advertise the framework version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
