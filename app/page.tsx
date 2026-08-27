import Link from "next/link";
import Brand from "./brand";
import "./landing.css";

export default function LandingPage() {
  return <main className="landing">
    <nav className="landing-nav landing-shell"><Brand /><div className="landing-links"><Link className="landing-login" href="/login">Log in</Link><Link className="landing-signup" href="/signup">Create account</Link></div></nav>
    <section className="landing-hero landing-shell">
      <div className="landing-hero-copy"><span className="landing-kicker">OddsAura Football</span><h1>Football predictions.<br /><i>Booking codes.</i></h1><p>Pick matches, build your slip and generate verified booking codes for supported bookmakers.</p><div className="landing-actions"><Link className="primary" href="/signup">Create account</Link><Link className="secondary" href="/login">Log in</Link></div></div>
      <div className="landing-bookmakers" aria-label="Supported bookmakers"><span>Bookmakers</span><div><strong>SportyBet</strong><strong>Bet9ja</strong><strong>betPawa</strong><strong>1xBet</strong><strong>BetKing</strong></div></div>
    </section>
    <section className="landing-shortcuts"><div className="landing-shell"><Link href="/daily"><span>01</span><strong>Daily Odds</strong></Link><Link href="/builder"><span>02</span><strong>Pick Matches</strong></Link><Link href="/results"><span>03</span><strong>Track Results</strong></Link></div></section>
    <section className="landing-section landing-shell" id="how-it-works"><h2>How it works</h2><div className="landing-steps"><article><span>1</span><h3>Pick predictions</h3></article><article><span>2</span><h3>Generate a code</h3></article><article><span>3</span><h3>Track results</h3></article></div></section>
    <section className="landing-cta landing-shell"><div><h2>Ready to pick?</h2><Link href="/signup">Create account →</Link></div></section>
    <footer className="landing-footer landing-shell"><Brand compact /><p>Predictions use football history, form and available odds. No prediction is guaranteed. 18+.</p><Link href="/login">Log in</Link></footer>
  </main>;
}
