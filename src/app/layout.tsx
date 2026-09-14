import type { Metadata } from "next";
import "./globals.css";
import { ToasterProvider } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { AuthHashForwarder } from "@/components/auth-hash-forwarder";
import { LANG_DIR, translate } from "@/lib/locale";
import { localeForRequest } from "@/lib/server-locale";


export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await localeForRequest();
  return {
    title: translate(lang, "meta_title"),
    description: translate(lang, "meta_desc"),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { lang, cur } = await localeForRequest();
  return (
    <html
      lang={lang}
      dir={LANG_DIR[lang]}
      className="scroll-smooth"
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=JetBrains+Mono:wght@400;500;600&family=Cairo:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ToasterProvider />
        <AuthHashForwarder />
        <Providers initialLang={lang} initialCur={cur}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
