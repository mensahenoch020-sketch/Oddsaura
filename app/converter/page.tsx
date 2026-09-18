import { redirect } from "next/navigation";

export default function ConverterPage() {
  redirect("/dashboard?tool=converter");
}
