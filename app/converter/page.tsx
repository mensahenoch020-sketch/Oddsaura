import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ConverterPage() {
  redirect("/dashboard#code-converter");
}
