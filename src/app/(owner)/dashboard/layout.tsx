import { redirect } from "next/navigation";
import { OwnerShell } from "@/components/dashboard/owner-shell";
import { getOwnerSessionForRsc } from "@/lib/owner-auth";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await getOwnerSessionForRsc();
  if (!session) {
    redirect("/auth/login");
  }
  return <OwnerShell>{children}</OwnerShell>;
}