import { NextResponse, type NextRequest } from "next/server";

import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/guards";
import { getUnreadCount, listNotifications } from "@/lib/notifications";

// ?count=1 -> just the unread badge number (cheap, polled by the bell).
export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor();
    if (request.nextUrl.searchParams.get("count") === "1") {
      return NextResponse.json({ unreadCount: await getUnreadCount(actor.id) });
    }
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(actor.id),
      getUnreadCount(actor.id),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (e) {
    return errorResponse(e);
  }
}
