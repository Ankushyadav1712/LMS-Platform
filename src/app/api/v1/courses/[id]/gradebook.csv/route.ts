import { errorResponse } from "@/lib/api";
import { getOwnedCourse } from "@/lib/courses";
import { getGradebook, gradebookToCsv } from "@/lib/gradebook";
import { requireActor } from "@/lib/guards";

// Owner-only CSV export. getOwnedCourse 404-masks non-owners.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const course = await getOwnedCourse(actor, id, { forWrite: false });

    const csv = gradebookToCsv(await getGradebook(course.id));
    const filename = `gradebook-${course.slug}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
