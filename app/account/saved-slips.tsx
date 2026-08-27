"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SavedSlip = { id: string; name: string; createdAt: number; picks: Array<{ predictionId: string }> };

function encode(picks: SavedSlip["picks"]) {
  return btoa(JSON.stringify(picks)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export default function SavedSlips() {
  const [slips, setSlips] = useState<SavedSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/slips").then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Saved slips could not be loaded.");
    setSlips(payload.slips ?? []);
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Saved slips could not be loaded.")).finally(() => setLoading(false)); }, []);

  async function remove(id: string) {
    const response = await fetch(`/api/slips/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) setSlips((current) => current.filter((item) => item.id !== id));
  }

  return <section className="saved-section"><div><span>Saved</span><h2>My slips</h2></div>{loading ? <p>Loading…</p> : error ? <p>{error}</p> : slips.length ? <div className="saved-grid">{slips.map((slip) => <article key={slip.id}><span>{new Date(slip.createdAt).toLocaleString()}</span><h3>{slip.name}</h3><p>{slip.picks.length} {slip.picks.length === 1 ? "selection" : "selections"}</p><div><Link href={`/builder?slip=${encode(slip.picks)}`}>Open</Link><button type="button" onClick={() => void remove(slip.id)}>Remove</button></div></article>)}</div> : <div className="saved-empty"><p>No saved slips</p><Link href="/dashboard">Choose matches</Link></div>}</section>;
}

