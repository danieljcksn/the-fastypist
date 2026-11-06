import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/account-shell";
import { isLang } from "@/i18n";
import { accountStrings } from "@/i18n/account";

export async function generateMetadata({ params }: LayoutProps<"/[lang]/sign-up">): Promise<Metadata> {
  const { lang } = await params;
  return { title: isLang(lang) ? accountStrings(lang).signIn.signUpTitle : undefined };
}

export default async function SignUpLayout({ children, params }: LayoutProps<"/[lang]/sign-up">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <AccountShell lang={lang} otherPath="/sign-up">
      {children}
    </AccountShell>
  );
}
