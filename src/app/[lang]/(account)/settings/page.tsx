import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/account-shell";
import { SettingsPanel } from "@/components/account/settings-panel";
import { isLang } from "@/i18n";
import { accountStrings } from "@/i18n/account";

export async function generateMetadata({ params }: PageProps<"/[lang]/settings">): Promise<Metadata> {
  const { lang } = await params;
  return { title: isLang(lang) ? accountStrings(lang).settings.title : undefined };
}

export default async function SettingsPage({ params }: PageProps<"/[lang]/settings">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <AccountShell lang={lang} otherPath="/settings">
      <SettingsPanel lang={lang} />
    </AccountShell>
  );
}
