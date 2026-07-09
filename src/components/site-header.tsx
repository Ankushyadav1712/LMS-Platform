import Link from "next/link";

/** Shared shell header: brand link plus per-page nav content. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="mb-10 flex items-center justify-between">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        LMS Platform
      </Link>
      {children ? <nav className="flex items-center gap-4">{children}</nav> : null}
    </header>
  );
}
