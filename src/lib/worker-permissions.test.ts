import { describe, it, expect } from "vitest";
import {
  canAcceptOrder,
  canMarkPaid,
  canSetArbitraryStatus,
  normalizeStaffRole,
} from "./worker-permissions";

describe("normalizeStaffRole", () => {
  it("accepts known roles only", () => {
    expect(normalizeStaffRole("Owner")).toBe("Owner");
    expect(normalizeStaffRole("Manager")).toBe("Manager");
    expect(normalizeStaffRole("Cashier")).toBe("Cashier");
  });

  it("rejects forged/unknown roles", () => {
    expect(normalizeStaffRole("owner")).toBeNull();
    expect(normalizeStaffRole("admin")).toBeNull();
    expect(normalizeStaffRole("")).toBeNull();
    expect(normalizeStaffRole(null)).toBeNull();
    expect(normalizeStaffRole(undefined)).toBeNull();
    expect(normalizeStaffRole({ role: "Owner" })).toBeNull();
  });
});

describe("order mutation matrix", () => {
  it("every staff role may accept", () => {
    expect(canAcceptOrder("Owner")).toBe(true);
    expect(canAcceptOrder("Manager")).toBe(true);
    expect(canAcceptOrder("Cashier")).toBe(true);
  });

  it("cashiers can never mark paid", () => {
    expect(canMarkPaid("Cashier")).toBe(false);
    expect(canMarkPaid("Manager")).toBe(true);
    expect(canMarkPaid("Owner")).toBe(true);
  });

  it("only owners set arbitrary states", () => {
    expect(canSetArbitraryStatus("Owner")).toBe(true);
    expect(canSetArbitraryStatus("Manager")).toBe(false);
    expect(canSetArbitraryStatus("Cashier")).toBe(false);
  });
});
