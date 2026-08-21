import Link from "next/link";
import Brand from "../brand";
import { getOddsAuraUser } from "../chatgpt-auth";
import SavedSlips from "./saved-slips";
import AccountSettings from "./settings";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getOddsAuraUser();
  return <main className="account-page"><header><Brand href="/dashboard" /><nav><Link href="/dashboard">Dashboard</Link><Link href="/builder">Build a slip</Link></nav></header><section className="account-hero"><span>My OddsAura</span><h1>{user.displayName}</h1><p>{user.email}</p></section><AccountSettings initialName={user.displayName} email={user.email} /><SavedSlips /></main>;
}
