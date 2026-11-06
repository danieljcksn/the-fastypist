"use client";

import { useParams } from "next/navigation";
import { FailureView } from "@/components/site/failure-view";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const { lang } = useParams();
  return <FailureView error={error} lang={lang} retry={retry} />;
}
