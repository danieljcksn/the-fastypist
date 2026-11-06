import { ClerkProvider } from "@clerk/nextjs";
import { ptBR } from "@clerk/localizations";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountRouteMark } from "@/components/account/account-route-mark";
import { clerkAppearance } from "@/components/account/appearance";
import { href, isLang } from "@/i18n";
import { ACCOUNTS } from "@/lib/accounts-flag";

export const metadata: Metadata = { robots: { index: false } };

/** The one place Clerk's UI loads. Never the root layout: that would put 450 KB on the typing page. */
export default async function AccountLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang) || !ACCOUNTS) notFound();
  return (
    <ClerkProvider
      appearance={clerkAppearance}
      {...(lang === "pt-br" ? { localization: ptBR } : {})}
      signInUrl={href(lang, "/sign-in")}
      signUpUrl={href(lang, "/sign-up")}
      signInFallbackRedirectUrl={href(lang, "/")}
      signUpFallbackRedirectUrl={href(lang, "/welcome")}
    >
      <AccountRouteMark />
      {children}
    </ClerkProvider>
  );
}
