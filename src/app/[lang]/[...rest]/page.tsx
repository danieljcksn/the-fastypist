import { notFound } from "next/navigation";

// Without this an unmatched URL never enters the [lang] layout, so the 404 could not say which language it is in.
export default function Unmatched() {
  notFound();
}
