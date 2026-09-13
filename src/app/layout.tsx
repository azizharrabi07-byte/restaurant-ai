import type { Metadata } from "next";
import "./globals.css";
import { ToasterProvider } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { AuthHashForwarder } from "@/components/auth-hash-forwarder";

export const metadata: Metadata = {
  title: "Sufra — QR Menu for Restaurants",
  description:
    "Build your digital menu in minutes. Let customers scan, browse, and order from their phones.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}