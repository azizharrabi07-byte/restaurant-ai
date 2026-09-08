import { OwnerShell } from "@/components/dashboard/owner-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}