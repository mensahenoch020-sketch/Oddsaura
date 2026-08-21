import Link from "next/link";
import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import SavedSlips from "./saved-slips";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireChatGPTUser("/account");
  return <main className="account-page">
    <header><Link href="/" className="account-brand"><span>↗</span>Odds<i>Aura</i></Link><nav><Link href="/builder">Build a slip</Link><Link href="/convert">Convert codes</Link><a href={chatGPTSignOutPath("/")}>Sign out</a></nav></header>
    <section className="account-hero"><span>My OddsAura</span><h1>{user.displayName}</h1><p>{user.email}</p></section>
    <SavedSlips />
  </main>;
}
