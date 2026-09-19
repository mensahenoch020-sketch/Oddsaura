import Link from "next/link";
import Brand from "../brand";
import ConverterForm from "../converter/converter-form";
import "../converter/converter.css";
import "./public-converter.css";

export default function PublicConverterPage() {
  const xHandle = process.env.NEXT_PUBLIC_ODDSAURA_X_HANDLE ?? "";
  return <main className="converter-page public-converter-page">
    <header className="public-converter-header">
      <Brand />
      <nav aria-label="OddsAura account"><Link href="/">Home</Link><Link href="/login">Log in</Link></nav>
    </header>
    <section className="converter-hero public-converter-hero">
      <span>Free self-service converter</span>
      <h1>Move your booking code.</h1>
      <p>Choose the original bookmaker and where you want the code. OddsAura reloads the source slip, matches the same fixtures and markets, then clearly labels anything the destination does not offer.</p>
      <div><b>No account required</b><b>Rate limited for fair use</b><b>Always check the final bookmaker slip</b></div>
    </section>
    <ConverterForm publicMode xHandle={xHandle} />
    <footer className="public-converter-footer"><p>OddsAura does not accept stakes or guarantee winnings. Booking codes and prices can change when bookmakers update their markets. 18+</p><Link href="/signup">Create an OddsAura account →</Link></footer>
  </main>;
}
