"use client";

import { useEffect, useState } from "react";

type GeneratedCode = {
  id: string;
  provider: string;
  code: string;
  deepLink?: string | null;
  createdAt: number;
  selections: { requested?: unknown[]; resolved?: unknown[]; unmatched?: unknown[] };
};

export default function GeneratedCodes() {
  const [codes, setCodes] = useState<GeneratedCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => { fetch("/api/codes").then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Booking-code history could not be loaded.");
    setCodes(payload.codes ?? []);
  }).catch((error) => setMessage(error instanceof Error ? error.message : "Booking-code history could not be loaded.")).finally(() => setLoading(false)); }, []);

  async function copy(code: string) {
    await navigator.clipboard.writeText(code); setMessage(`${code} copied.`); window.setTimeout(() => setMessage(""), 1600);
  }

  return <section className="saved-section codes-section"><div><span>History</span><h2>Booking codes</h2></div>{message && <p className="codes-message" role="status">{message}</p>}{loading ? <p>Loading…</p> : codes.length ? <div className="saved-grid">{codes.map((item) => <article key={item.id}><span>{new Date(item.createdAt).toLocaleString()}</span><h3 className="saved-code">{item.code}</h3><p>{item.selections.resolved?.length ?? 0} selections{item.selections.unmatched?.length ? ` · ${item.selections.unmatched.length} excluded` : ""}</p><div><button type="button" onClick={() => void copy(item.code)}>Copy</button>{item.deepLink ? <a href={item.deepLink} target="_blank" rel="noreferrer">Open</a> : null}</div></article>)}</div> : <div className="saved-empty"><p>No codes yet</p><a href="/dashboard">Build slip</a></div>}</section>;
}
