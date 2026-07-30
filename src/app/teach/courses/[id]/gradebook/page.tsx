import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getGradebook } from "@/lib/gradebook";
import { requirePageRole } from "@/lib/guards";

export default async function GradebookPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageRole("/teach", "INSTRUCTOR", "ADMIN");
  const { id } = await params;

  const course = await db.course.findUnique({ where: { id } });
  if (!course || !can.manageCourse(actor, course)) notFound();

  const gb = await getGradebook(course.id);

  return (
    <section className="space-y-6">
      <div>
        <Link
          href={`/teach/courses/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {course.title}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Gradebook</h1>
          <Button variant="outline" render={<a href={`/api/v1/courses/${id}/gradebook.csv`} />}>
            Download CSV
          </Button>
        </div>
      </div>

      {gb.students.length === 0 ? (
        <p className="text-sm text-muted-foreground">No enrolled students yet.</p>
      ) : gb.assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Student</TableHead>
                {gb.assignments.map((a) => (
                  <TableHead key={a.id} className="text-center">
                    {a.title}
                    <span className="block text-xs font-normal text-muted-foreground">
                      /{a.maxPoints}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {gb.students.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="sticky left-0 bg-background font-medium">
                    {s.name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {s.email}
                    </span>
                  </TableCell>
                  {gb.assignments.map((a) => {
                    const pts = gb.cells[`${s.id}:${a.id}`];
                    return (
                      <TableCell key={a.id} className="text-center">
                        {pts === undefined ? <span className="text-muted-foreground">—</span> : pts}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
