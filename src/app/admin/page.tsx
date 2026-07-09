import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { can } from "@/lib/authz";
import { requirePageRole } from "@/lib/guards";
import { db } from "@/lib/db";

import { RoleSelect } from "./role-select";

// Defense in depth: the layout also gates, but every page checks on its own.
export default async function AdminUsersPage() {
  const actor = await requirePageRole("/admin", "ADMIN");

  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">User management</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Promote users to instructor or admin. You cannot change your own role.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-[180px]">Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell className="text-muted-foreground">{user.email}</TableCell>
              <TableCell className="text-muted-foreground">
                {user.createdAt.toLocaleDateString()}
              </TableCell>
              <TableCell>
                <RoleSelect
                  userId={user.id}
                  role={user.role}
                  disabled={!can.changeRole(actor, user)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
