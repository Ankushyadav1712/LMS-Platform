import { Button } from "@/components/ui/button";

/** Shared submit row for settings forms: Save button + error / "Saved" note. */
export function SaveFooter({
  pending,
  error,
  saved,
  label,
}: {
  pending: boolean;
  error: string | null;
  saved: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : saved ? (
        <p className="text-sm text-muted-foreground">Saved</p>
      ) : null}
    </div>
  );
}
