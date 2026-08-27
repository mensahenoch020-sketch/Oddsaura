import ProductNavigation from "../product-navigation";
import { getOddsAuraUser } from "../chatgpt-auth";
import SavedSlips from "./saved-slips";
import GeneratedCodes from "./generated-codes";
import AccountSettings from "./settings";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getOddsAuraUser();
  return <main className="account-page"><ProductNavigation active="profile" /><section className="account-hero"><span>Account</span><h1>Profile</h1><p>{user.displayName} · {user.email}</p></section><AccountSettings initialName={user.displayName} email={user.email} /><GeneratedCodes /><SavedSlips /></main>;
}
