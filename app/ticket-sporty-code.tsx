"use client";

import { useState } from "react";
import Link from "next/link";
import type { Ticket } from "./data";
import { generateSportyBetCode, type SportyBetCodeResponse } from "./builder/providers";

function builderLink(ticket: Ticket) {
  const encoded = btoa(JSON.stringify(ticket.selections.map((selection) => ({ predictionId: selection.id }))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `/builder?slip=${encodeURIComponent(encoded)}`;
}

export default function TicketSportyCode({ ticket }: { ticket: Ticket }) {
  const [result, setResult] = useState<SportyBetCodeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function create() {
    setLoading(true);
    setMessage("Checking every leg against SportyBet…");
    try {
      const code = await generateSportyBetCode(ticket.selections.map((selection) => ({
        fixtureId: selection.fixtureId,
        homeTeam: selection.homeTeam.name,
        awayTeam: selection.awayTeam.name,
        kickoff: selection.kickoff,
        marketKey: selection.market.key,
        marketName: selection.market.name,
        selection: selection.selection,
        line: selection.market.line,
      })), true);
      setResult(code);
      window.localStorage.setItem(`oddsaura-code-${ticket.id}`, JSON.stringify(code));
      setMessage(code.partial ? `${code.resolved.length} of ${ticket.selections.length} legs were included.` : `All ${code.resolved.length} legs verified.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "SportyBet could not create this ticket code.");
    } finally { setLoading(false); }
  }

  return <div className="oa-ticket-code">
    {result ? <>
      <span>Verified SportyBet code</span>
      <strong>{result.code}</strong>
      <div><button type="button" onClick={() => void navigator.clipboard.writeText(result.code)}>Copy code</button><a href={result.deepLink} target="_blank" rel="noreferrer">Load betslip ↗</a></div>
      {result.unmatched.length ? <small>{result.unmatched.length} unavailable {result.unmatched.length === 1 ? "leg was" : "legs were"} dropped. <Link href={builderLink(ticket)}>Review ticket</Link></small> : null}
    </> : <button className="oa-create-code" type="button" disabled={loading} onClick={() => void create()}>{loading ? "Creating verified code…" : "Create SportyBet code"}<b>→</b></button>}
    {message ? <small>{message}</small> : null}
  </div>;
}
