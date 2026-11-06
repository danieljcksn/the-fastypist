import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { href, isLang } from "@/i18n";

export function generateStaticParams() {
  return [{ "sign-in": [] }];
}

async function Panel({ params }: { params: PageProps<"/[lang]/sign-in/[[...sign-in]]">["params"] }) {
  const { lang } = await params;
  if (!isLang(lang)) return null;
  return <SignIn routing="path" path={href(lang, "/sign-in")} signUpUrl={href(lang, "/sign-up")} />;
}

/** Suspense is not optional: with cacheComponents a bare SignIn fails the build. */
export default function SignInPage({ params }: PageProps<"/[lang]/sign-in/[[...sign-in]]">) {
  return (
    <div className="ac-auth-box">
      <Suspense fallback={null}>
        <Panel params={params} />
      </Suspense>
    </div>
  );
}
