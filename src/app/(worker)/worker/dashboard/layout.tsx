import { WorkerShell } from "@/components/dashboard/worker-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkerShell>{children}</WorkerShell>;
}