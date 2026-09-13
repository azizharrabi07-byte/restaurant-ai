import { randomBytes } from "crypto";

/** Matches the product's documented 24-hour invite UX. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Server-generated invite tokens are never client-chosen: 128-bit hex. */
export function newInviteToken(): string {
  return randomBytes(16).toString("hex");
}

/** Worker session secrets: 256-bit hex, stored on the workers row. */
export function newWorkerSessionToken(): string {
  return randomBytes(32).toString("hex");
}
