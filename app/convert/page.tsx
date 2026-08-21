import Link from "next/link";
import "./convert.css";

export default function ConvertPage() {
  return <main className="convert-page">
    <header><Link href="/" className="convert-brand"><span>↗</span>Odds<i>Aura</i></Link><nav><Link href="/builder">Prediction builder</Link><Link href="/login">Account</Link></nav></header>
    <section className="convert-intro"><div><span>Universal bet-code converter</span><h1>Convert on any<br /><i>phone or computer.</i></h1></div><p>Use an existing booking code from one bookmaker and convert it to SportyBet, Bet9ja, 1xBet, BetPawa and many others. The converter is supplied by ConvertBetCodes and works independently of OddsAura’s blocked server connection.</p></section>
    <section className="convert-frame"><div><strong>Cross-platform converter</strong><span>Powered by ConvertBetCodes · third-party service</span><a href="https://convertbetcodes.com/" target="_blank" rel="noreferrer">Open full screen ↗</a></div><iframe title="ConvertBetCodes universal booking-code converter" src="https://convertbetcodes.com/" loading="lazy" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin" /></section>
    <section className="convert-notes"><article><span>01</span><h2>Build your OddsAura slip</h2><p>Select predictions, then save or share the neutral slip from the builder.</p></article><article><span>02</span><h2>Use any origin code</h2><p>If you already have that slip on another bookmaker, paste its code into the converter.</p></article><article><span>03</span><h2>Review before betting</h2><p>Markets and prices can change. Confirm every converted selection on the bookmaker.</p></article></section>
    <p className="convert-disclaimer">18+ · OddsAura does not operate the converter, hold betting funds or guarantee results.</p>
  </main>;
}
