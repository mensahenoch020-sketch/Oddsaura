import Link from "next/link";
import ProductNavigation from "../product-navigation";
import { getOddsAuraUser } from "../chatgpt-auth";
import SavedSlips from "./saved-slips";
import GeneratedCodes from "./generated-codes";
import AccountSettings from "./settings";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getOddsAuraUser();
  return <main className="account-page"><ProductNavigation active="profile" initialName={user.displayName} initialRole={user.role} /><section className="account-hero"><span>Signed-in account</span><h1>{user.displayName}</h1><p>{user.email}</p><div className="account-shortcuts">{user.role === "ADMIN" ? <Link href="/admin">Open admin dashboard</Link> : <span>Admin access appears here when this account is promoted.</span>}</div></section><AccountSettings initialName={user.displayName} email={user.email} /><GeneratedCodes /><SavedSlips /></main>;
}
