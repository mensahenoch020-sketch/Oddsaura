"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import Brand from "./brand";

const prompts = [
  { icon: "↗", text: "Give me 20 odds for Sporty" },
  { icon: "↯", text: "Split 100 odds into 3 Sporty codes" },
  { icon: "⇄", text: "Convert a Betway code to SportyBet" },
  { icon: "✓", text: "Show today’s qualified odds" },
];

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

  return <main className="assistant-app landing-assistant">
    <header className="landing-assistant-header">
      <Brand />
      <nav aria-label="Account">
        <Link href="/login">Log in</Link>
        <Link className="landing-create-account" href="/signup">Create account</Link>
      </nav>
    </header>
    <div className="assistant-shell">
      <div className="assistant-toolbar">
        <span><i /> Verified football data</span>
        <Link className="landing-open-account" href="/login">Open OddsAura</Link>
      </div>
      <section className="assistant-workspace">
        <div className="assistant-welcome">
          <div className="assistant-orb" aria-hidden="true"><i /><i /><span /></div>
          <span>OddsAura Assistant</span>
          <h1>What do you want to bet?</h1>
          <p>Ask naturally. Build any target odds, split slips, convert booking codes, find the strongest matches or check recent results.</p>
          <div className="assistant-prompts">
            {prompts.map((prompt) => <button key={prompt.text} type="button" onClick={() => continueWith(prompt.text)}><b>{prompt.icon}</b>{prompt.text}</button>)}
          </div>
        </div>
        <div className="assistant-composer-dock landing-composer-dock">
          <form className="assistant-composer" onSubmit={submit}>
            <label htmlFor="public-assistant-request">Ask OddsAura</label>
            <textarea id="public-assistant-request" rows={1} value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Ask OddsAura anything…" maxLength={500} />
            <button type="submit" disabled={!request.trim()} aria-label="Continue with request"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6z" /><path d="m12 13 7-8" /></svg></button>
          </form>
          <p>Log in to receive verified selections and bookmaker codes · 18+</p>
        </div>
      </section>
    </div>
    <p className="landing-supported" aria-label="Supported bookmakers"><span>SportyBet</span><span>Bet9ja</span><span>betPawa</span><span>BetKing</span><span>Betway</span></p>
  </main>;
}
