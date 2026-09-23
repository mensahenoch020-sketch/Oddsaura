import type { ReactNode } from "react";
import Link from "next/link";
import Brand from "./brand";
import LegalFooter from "./legal-footer";

export default function LegalShell({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return <main className="legal-page">
    <header className="legal-header"><Brand /><Link href="/">Back to OddsAura</Link></header>
    <div className="legal-layout">
      <aside className="legal-intro"><span className="legal-kicker">{kicker}</span><h1>{title}</h1><p>Plain-language information about using OddsAura and how we protect users.</p><span className="legal-updated">Last updated: 23 September 2026</span></aside>
      <article className="legal-copy">{children}</article>
    </div>
    <LegalFooter />
  </main>;
}
