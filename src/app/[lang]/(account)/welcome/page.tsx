import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/account-shell";
import { WelcomeForm } from "@/components/account/welcome-form";
import { isLang } from "@/i18n";
import { accountStrings } from "@/i18n/account";

export async function generateMetadata({ params }: PageProps<"/[lang]/welcome">): Promise<Metadata> {
  const { lang } = await params;
  return { title: isLang(lang) ? accountStrings(lang).welcome.title : undefined };
}

export default async function WelcomePage({ params }: PageProps<"/[lang]/welcome">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <AccountShell lang={lang} otherPath="/welcome">
      <WelcomeForm lang={lang} />
    </AccountShell>
  );
}
