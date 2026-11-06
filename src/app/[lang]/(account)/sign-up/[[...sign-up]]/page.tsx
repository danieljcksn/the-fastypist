import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { href, isLang } from "@/i18n";

export function generateStaticParams() {
  return [{ "sign-up": [] }];
}

async function Panel({ params }: { params: PageProps<"/[lang]/sign-up/[[...sign-up]]">["params"] }) {
  const { lang } = await params;
  if (!isLang(lang)) return null;
  return <SignUp routing="path" path={href(lang, "/sign-up")} signInUrl={href(lang, "/sign-in")} />;
}

export default function SignUpPage({ params }: PageProps<"/[lang]/sign-up/[[...sign-up]]">) {
  return (
    <div className="ac-auth-box">
      <Suspense fallback={null}>
        <Panel params={params} />
      </Suspense>
    </div>
  );
}
