import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getOwnerSessionForRsc } from "@/lib/owner-auth";
import { translate } from "@/lib/locale";
import { currentLang } from "@/lib/server-locale";

export async function generateMetadata() {
  return { title: translate(await currentLang(), "meta_signup") };
}

export default async function SignupPage() {
  const session = await getOwnerSessionForRsc();
  if (session) redirect("/dashboard");

  return <AuthForm mode="signup" />;
}
