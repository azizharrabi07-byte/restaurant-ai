/**
 * Server-enforced staff permission matrix for order mutations.
 *
 * Pure functions so the matrix is unit-testable; the PATCH route applies it
 * against the DB-verified role. Client-side role display is UI hint only.
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

/** Every staff role (and the owner) may accept a pending order. */
export function canAcceptOrder(role: StaffRole): boolean {
  return role === "Owner" || role === "Manager" || role === "Cashier";
}

/** Owners alone may reopen or rewrite arbitrary states. */
export function canSetArbitraryStatus(role: StaffRole): boolean {
  return role === "Owner";
}
