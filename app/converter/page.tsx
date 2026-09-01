import ProductNavigation from "../product-navigation";
import { getOddsAuraUser } from "../chatgpt-auth";
import ConverterForm from "./converter-form";
import "./converter.css";

export const dynamic = "force-dynamic";

export default async function ConverterPage() {
  const user = await getOddsAuraUser();
  return <main className="converter-page"><ProductNavigation active="converter" initialName={user.displayName} initialRole={user.role} /><section className="converter-hero"><span>Universal converter</span><h1>Move a bet code</h1><p>Load the original selections, match them against the destination bookmaker’s live markets, and create a newly verified code.</p></section><ConverterForm /></main>;
}
