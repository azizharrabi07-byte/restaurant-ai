import { redirect } from "next/navigation";
import { getOwnerSessionForRsc } from "@/lib/owner-auth";
import { ForgotForm } from "@/components/forgot-form";
import { translate } from "@/lib/locale";
import { currentLang } from "@/lib/server-locale";

export async function generateMetadata() {
  return { title: translate(await currentLang(), "meta_forgot") };
}

export default async function ForgotPage() {
  const session = await getOwnerSessionForRsc();
  if (session) redirect("/dashboard");

  return <ForgotForm />;
}
