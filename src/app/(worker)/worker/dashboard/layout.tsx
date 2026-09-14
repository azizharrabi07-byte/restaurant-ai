import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { WorkerShell } from "@/components/dashboard/worker-shell";
import { getWorkerSession } from "@/lib/worker-auth";
import { hasBackend } from "@/lib/supabase-admin";

export default async function Layout({ children }: { children: React.ReactNode }) {
  // Server-side guard, mirroring the owner layout: the worker cookie is
  // validated before the dashboard renders, so a device with no session (or a
  // forged localStorage entry) can never see an operational terminal. Offline/
  // demo deployments have no credentials and therefore no session to check —
  // there the client-side flow stays in charge.
  if (hasBackend()) {
    const store = await cookies();
    const cookie = store
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const req = new Request("http://localhost/worker/dashboard", {
      headers: cookie ? { cookie } : undefined,
    });
    const session = await getWorkerSession(req);
    if (!session) redirect("/");
  }
  return <WorkerShell>{children}</WorkerShell>;
}