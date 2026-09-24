"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import Brand from "./brand";
import LegalFooter from "./legal-footer";

const samplePicks = [
  ["Netherlands vs Germany", "Both teams to score", "1.70"],
  ["Norway vs Denmark", "Norway moneyline", "2.10"],
  ["Portugal vs Wales", "Portugal draw no bet", "1.42"],
];

const competitions = ["Premier League", "La Liga", "Serie A", "Champions League", "Nations League", "Africa Cup of Nations"];

export default function PublicAssistant() {
  const [request, setRequest] = useState("");

  function continueWith(text: string) {
    const next = `/dashboard?request=${encodeURIComponent(text)}`;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = request.trim();
    if (clean) continueWith(clean);
  }

  return <main className="oa-landing">
    <header className="oa-landing-nav">
      <Brand />
      <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#coverage">Coverage</a><Link href="/login">Log in</Link><Link className="oa-nav-cta" href="/signup">Get started</Link></nav>
    </header>

    <section className="oa-hero">
      <div className="oa-hero-copy">
        <span className="oa-kicker"><i /> Football decisions, made clearer</span>
        <h1>Find the right pick.<br /><em>Build the real slip.</em></h1>
        <p>Ask for a competition, date, market or target odds. OddsAura checks the available football data and builds supported bookmaker codes without quietly changing your request.</p>
        <form className="oa-hero-ask" onSubmit={submit}>
          <label htmlFor="landing-request">Ask OddsAura</label>
          <textarea id="landing-request" rows={2} value={request} onChange={(event) => setRequest(event.target.value)} placeholder="20 odds for Nations League on SportyBet" maxLength={500} />
          <button type="submit" disabled={!request.trim()} aria-label="Continue with request">Ask <span>→</span></button>
        </form>
        <div className="oa-hero-links"><button type="button" onClick={() => continueWith("Premier League matches")}>Premier League matches</button><button type="button" onClick={() => continueWith("Best protection for today")}>Best protection today</button></div>
      </div>

      <div className="oa-product-preview" aria-label="Example OddsAura betslip">
        <header><div><span>ODDSAURA PICK BUILDER</span><b>Verified markets</b></div><strong>2.00</strong></header>
        <div className="oa-preview-list">{samplePicks.map(([match, market, odds]) => <article key={match}><span>✓</span><div><b>{match}</b><small>{market}</small></div><strong>{odds}</strong></article>)}</div>
        <div className="oa-preview-code"><span>EXAMPLE SLIP</span><span>DEMO ONLY</span><b>Sample picks</b></div>
        <small>Illustrative picks only · No bookmaker code was created</small>
      </div>
    </section>

    <section className="oa-trust-strip" aria-label="Supported bookmakers"><p>Built around the bookmakers you already use</p><div><span>SportyBet</span><span>Bet9ja</span><span>betPawa</span><span>BetKing</span><span>Betway</span></div></section>

    <section className="oa-section" id="how-it-works">
      <header className="oa-section-heading"><span>One simple workspace</span><h2>From question to<br /><em>bookmaker code.</em></h2><p>OddsAura keeps the hard parts behind the screen. You see the match, selection, price and code—not internal model language.</p></header>
      <div className="oa-feature-grid"><article><b>01</b><h3>Ask normally</h3><p>Name the exact league, date, bookmaker, market or odds you want. Your filters stay locked.</p></article><article><b>02</b><h3>Review the picks</h3><p>See each match and market in plain language, including anything the bookmaker could not supply.</p></article><article><b>03</b><h3>Use or save</h3><p>Copy the booking code or save a clean betslip image straight from the conversation.</p></article></div>
    </section>

    <section className="oa-coverage" id="coverage">
      <div><span className="oa-kicker"><i /> Competition-aware</span><h2>Your league means<br /><em>that league.</em></h2><p>Ask for a single competition, combine leagues, or include an exact date. OddsAura will not fill the answer with unrelated matches when the requested schedule is unavailable.</p><Link href="/signup">Explore competitions <span>→</span></Link></div>
      <div className="oa-competition-list">{competitions.map((competition, index) => <button type="button" onClick={() => continueWith(`${competition} matches`)} key={competition}><span>{String(index + 1).padStart(2, "0")}</span><b>{competition}</b><i>→</i></button>)}</div>
    </section>

    <section className="oa-convert-section"><div className="oa-convert-card"><span>CODE CONVERTER</span><h2>Move the available matches.</h2><p>Load a bookmaker code, translate supported markets and clearly see every selection that could not be included.</p><Link href="/convert">Open converter <span>→</span></Link></div><div className="oa-upload-card"><span>IMAGE TO CODE</span><h2>Turn a screenshot into a slip.</h2><p>Upload prediction cards, bookmaker fixture rows or simple team-and-market lists. Review the matches before creating a code.</p><Link href="/signup">Upload predictions <span>→</span></Link></div></section>

    <section className="oa-final-cta"><span>Ready when you are</span><h2>Ask. Review. Build.</h2><p>Create your free workspace and keep your slips, codes and saved images together.</p><Link href="/signup">Create account <span>→</span></Link></section>
    <LegalFooter className="oa-landing-footer" />
  </main>;
}
