import { WorkerShell } from "@/components/dashboard/worker-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  // No server redirect here by design: worker devices in offline/demo mode
  // carry no cookie, and the layout cannot read localStorage. Enforcement
  // happens in WorkerShell (server-validated via /api/auth/worker/me) and,
  // decisively, in the APIs themselves (GET/PATCH /api/orders 401 without a
  // valid worker or owner session), so no order data ever renders unauthenticated.
  return <WorkerShell>{children}</WorkerShell>;
}