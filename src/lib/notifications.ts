import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// In-app notifications only (no websockets — the bell polls). Payload shape
// is per-type; keep it small and render-ready.
export type NotificationType = "GRADED";

export type GradedPayload = {
  courseSlug: string;
  assignmentId: string;
  assignmentTitle: string;
  points: number;
  maxPoints: number;
};

/** Create a notification. Accepts a tx client so it can join a grading tx. */
export function notify(
  client: Prisma.TransactionClient | typeof db,
  userId: string,
  type: NotificationType,
  payload: GradedPayload,
) {
  return client.notification.create({
    data: { userId, type, payload },
  });
}

export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, limit = 30) {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Mark one (by id) or all of a user's notifications read. Scoped to the
 * user so no one can mark someone else's notifications. */
export async function markRead(userId: string, id?: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}
