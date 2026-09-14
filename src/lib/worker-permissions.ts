/**
 * Server-enforced staff permission matrix for order mutations.
 * Pure functions so the matrix is unit-testable; `PATCH /api/orders/[id]`
 * applies every predicate below against the DB-verified role — `canMarkPaid`
 * for the paid branch, `canAcceptOrder` for `accepted`, `canSetArbitraryStatus`
 * for `pending` (reopen). Client-side role display is UI hint only.
 */

export type StaffRole = "Owner" | "Manager" | "Cashier";

export function normalizeStaffRole(role: unknown): StaffRole | null {
  if (role === "Owner" || role === "Manager" || role === "Cashier") return role;
  return null;
}

/** Cashiers accept orders but must never mark them paid. */
export function canMarkPaid(role: StaffRole): boolean {
  return role === "Owner" || role === "Manager";
}

/**
 * Every staff role (and the owner) may accept a pending order. Consumed by
 * the PATCH route's `accepted` branch instead of an inline status set, so the
 * tested predicate is the executed one.
 */
export function canAcceptOrder(role: StaffRole): boolean {
  return role === "Owner" || role === "Manager" || role === "Cashier";
}

/** Owners alone may reopen or rewrite arbitrary states. */
export function canSetArbitraryStatus(role: StaffRole): boolean {
  return role === "Owner";
}
