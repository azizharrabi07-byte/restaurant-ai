import { NextResponse } from "next/server";
import { clearOwnerSessionCookie } from "@/lib/owner-auth";
import { clearWorkerSessionCookie } from "@/lib/worker-auth";

export async function POST() {
  const res = NextResponse.json({ cloud: true });
  res.headers.append("Set-Cookie", clearWorkerSessionCookie());
  return clearOwnerSessionCookie(res);
}