import { auth, clerkClient } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AccountShell } from "@/components/account/account-shell";
import { AdminPanel, AdminSkeleton } from "@/components/boards/admin-panel";
import { isLang, type Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { ACCOUNTS } from "@/lib/accounts-flag";

export async function generateMetadata({ params }: PageProps<"/[lang]/admin">): Promise<Metadata> {
  const { lang } = await params;
  return { title: isLang(lang) && ACCOUNTS ? boardStrings(lang).admin.title : undefined };
}

/** The page checks the role as every admin handler does, from Clerk, so a removed role stops working at the next request. */
async function Gate({ lang }: { lang: Lang }) {
  const { userId } = await auth();
  if (!userId) notFound();
  const user = await (await clerkClient()).users.getUser(userId);
  if (user.publicMetadata.role !== "admin") notFound();
  return <AdminPanel lang={lang} />;
}

export default async function AdminPage({ params }: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  // The layout's notFound() doesn't stop this page rendering beside it, and auth() with no Clerk proxy logs an error.
  if (!isLang(lang) || !ACCOUNTS) notFound();
  return (
    <AccountShell lang={lang} otherPath="/admin">
      <Suspense fallback={<AdminSkeleton lang={lang} />}>
        <Gate lang={lang} />
      </Suspense>
    </AccountShell>
  );
}
