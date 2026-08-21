const picks = [
  { match: "Arsenal vs. Brighton", market: "Over 1.5 Goals", odds: "1.28", chance: 82, note: "Both teams cleared this line in 8 of their last 10." },
  { match: "Real Madrid vs. Sevilla", market: "Real Madrid to Win", odds: "1.36", chance: 78, note: "Strong home form and a clear quality edge." },
  { match: "Inter vs. Atalanta", market: "Double Chance: Inter or Draw", odds: "1.24", chance: 85, note: "Inter are unbeaten in their last 9 at home." },
];

const features = [
  ["Probability first", "Every selection is scored from form, goals, venue strength, match history and market value."],
  ["Ready-to-use codes", "Build a ticket, copy its booking code, and load it straight into your preferred bookmaker."],
  ["Results in the open", "Follow every published ticket—won, lost or pending—so performance stays transparent."],
  ["Build my odds", "Choose your target odds and risk level. OddsAura creates a sensible ticket around it."],
  ["Market intelligence", "Filter for common markets like Over 1.5, BTTS, double chance and match winners."],
  ["Made for match day", "Fast, clear and mobile-first—made for checking a ticket before kick-off."],
];

function Logo() {
  return <span className="brand-mark" aria-hidden="true"><i /><b /><em /></span>;
}

export default function Home() {
  return <main>
    <nav className="nav shell" aria-label="Primary navigation">
      <a className="brand" href="#top" aria-label="OddsAura home"><Logo /><span>Odds<span>Aura</span></span></a>
      <div className="nav-links"><a href="#picks">Today&apos;s picks</a><a href="#how-it-works">How it works</a><a href="#features">Features</a></div>
      <a className="nav-cta" href="#join">Get started <span>→</span></a>
    </nav>

    <section id="top" className="hero shell">
      <div className="hero-copy">
        <div className="eyebrow"><span className="pulse" /> Probability-led football picks</div>
        <h1>Make match day<br /><i>more informed.</i></h1>
        <p className="hero-text">OddsAura turns football data into clear, probability-scored picks and ready-to-copy booking codes—so you can spend less time searching and more time deciding.</p>
        <div className="hero-actions"><a className="button button-primary" href="#picks">Explore today&apos;s picks <span>↗</span></a><a className="button button-ghost" href="#how-it-works">How it works <span>↓</span></a></div>
        <div className="hero-proof"><div className="avatars"><span>J</span><span>M</span><span>A</span><span>+</span></div><p><strong>Data, not noise.</strong><br />Every pick includes the why.</p></div>
      </div>
      <div className="hero-visual" aria-label="Example OddsAura prediction ticket">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" />
        <div className="ticket-card">
          <div className="ticket-top"><span className="mini-brand"><span className="mini-mark" /> OddsAura</span><span className="live-tag"><i /> Live board</span></div>
          <div className="ticket-heading"><p>Today&apos;s balanced ticket</p><strong>6.42 <small>total odds</small></strong></div>
          <div className="ticket-games">{picks.map((pick) => <div className="ticket-game" key={pick.match}><div><strong>{pick.match}</strong><span>{pick.market}</span></div><b>{pick.odds}</b></div>)}</div>
          <div className="ticket-footer"><div><span>Confidence</span><strong>81%</strong></div><button type="button">View ticket <span>→</span></button></div>
        </div>
        <div className="float-card float-score"><span>Model score</span><strong>81<span>%</span></strong><i>↑ 4.6%</i></div>
        <div className="float-card float-code"><span className="code-icon">⌘</span><div><small>Booking code ready</small><strong>OAR-6Q8F</strong></div><b>✓</b></div>
      </div>
    </section>

    <section className="metrics"><div className="shell metric-inner"><p>Built for clearer decisions, not empty promises.</p><div><strong>Probability-led</strong><span>analysis</span></div><div><strong>Mobile-first</strong><span>experience</span></div><div><strong>Transparent</strong><span>tracking</span></div></div></section>

    <section id="picks" className="picks shell">
      <div className="section-intro"><div><span className="section-kicker">Today&apos;s board</span><h2>The picks worth<br /><i>looking at.</i></h2></div><p>Each recommendation is selected against a set of measurable match signals. Read the reasoning, see the risk, then decide for yourself.</p></div>
      <div className="pick-layout"><div className="pick-list">{picks.map((pick, index) => <article className="pick-row" key={pick.match}><div className="pick-number">0{index + 1}</div><div className="pick-main"><h3>{pick.match}</h3><p>{pick.note}</p><div className="pick-tags"><span>{pick.market}</span><span>Pre-match</span></div></div><div className="pick-confidence"><span>Probability</span><strong>{pick.chance}%</strong><div><i style={{ width: `${pick.chance}%` }} /></div></div><div className="pick-odds"><span>Odds</span><strong>{pick.odds}</strong></div></article>)}</div>
      <aside className="code-panel"><div className="panel-dots"><i /><i /><i /></div><span className="panel-kicker">Ready when you are</span><h3>Today&apos;s<br /><i>balanced</i> ticket</h3><div className="panel-stat"><span>Total odds</span><strong>6.42</strong></div><div className="panel-stat"><span>Selections</span><strong>3 games</strong></div><div className="code-box"><span>Booking code</span><strong>OAR-6Q8F</strong><button type="button" aria-label="Copy booking code">⧉</button></div><button className="panel-button" type="button">Copy booking code <span>→</span></button><small>Always check odds and markets before placing a bet.</small></aside></div>
    </section>

    <section id="how-it-works" className="how"><div className="shell"><div className="section-intro how-intro"><div><span className="section-kicker">Simple by design</span><h2>From data to<br /><i>decision.</i></h2></div><p>No overcomplicated dashboards. Just the right context, the right ticket and a smoother path to your bookmaker.</p></div><div className="steps"><article><span>01</span><div className="step-icon data-icon"><i /><i /><i /></div><h3>We read the match</h3><p>Team form, scoring patterns, venue performance and market movement become a clear probability score.</p></article><article><span>02</span><div className="step-icon filter-icon"><i /><i /></div><h3>We filter the noise</h3><p>Only picks that meet the confidence and value thresholds make it onto the board.</p></article><article><span>03</span><div className="step-icon code-step-icon">⌘</div><h3>You copy and play</h3><p>Open the ticket, copy the code, then verify the selections in your bookmaker before you stake.</p></article></div></div></section>

    <section id="features" className="features shell"><div className="features-head"><span className="section-kicker">More than picks</span><h2>A calmer way to<br /><i>follow football.</i></h2></div><div className="feature-grid">{features.map(([title, text], index) => <article key={title}><span className="feature-index">0{index + 1}</span><div className="feature-arrow">↗</div><h3>{title}</h3><p>{text}</p></article>)}</div></section>

    <section id="join" className="join shell"><div className="join-inner"><div><span className="section-kicker">Start with the signal</span><h2>Better context.<br /><i>Better decisions.</i></h2></div><div><p>Get the day&apos;s probability-led football board in one place. No hype, no “sure wins”—just useful information when it matters.</p><a className="button button-primary" href="mailto:hello@oddsaura.com">Join OddsAura <span>↗</span></a></div><div className="join-ball" aria-hidden="true"><i /></div></div></section>
    <footer className="footer shell"><a className="brand" href="#top"><Logo /><span>Odds<span>Aura</span></span></a><p>© 2026 OddsAura. Football data, thoughtfully used.</p><p className="footer-note">18+ · Please bet responsibly.</p></footer>
  </main>;
}
