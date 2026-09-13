import { NextResponse } from "next/server";
import { getOwnerSessionForRequest } from "@/lib/owner-auth";

export async function GET(req: Request) {
  const session = await getOwnerSessionForRequest(req);
  return NextResponse.json({
    cloud: Boolean(session),
    user: session ? { id: session.user.userId, email: session.user.email } : null,
  });
}