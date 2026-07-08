/**
 * URL-safe slug from a human title: lowercase, alphanumeric, hyphen-separated.
 * Course slugs must be unique; callers append a suffix on collision.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Slug with a short random suffix, for collision retries. */
export function slugifyUnique(input: string, suffix: string): string {
  const base = slugify(input);
  return base ? `${base}-${suffix}` : suffix;
}
