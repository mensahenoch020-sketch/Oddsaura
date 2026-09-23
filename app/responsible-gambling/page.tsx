import type { Metadata } from "next";
import Link from "next/link";
import LegalShell from "../legal-shell";

export const metadata: Metadata = { title: "Responsible Gambling | OddsAura", description: "Practical guidance for using football betting information responsibly.", alternates: { canonical: "/responsible-gambling" } };

export default function ResponsibleGamblingPage() {
  return <LegalShell kicker="Stay in control" title="Play responsibly.">
    <section><h2>Betting should stay optional</h2><p>OddsAura cannot guarantee a win. Every bet can lose, including selections described as safer, protected or high confidence. Never treat football betting as income, an investment or a way to solve financial problems.</p></section>
    <section><h2>Practical limits</h2><ul><li>Set a money limit and a time limit before you begin.</li><li>Use only money you can afford to lose after essential expenses.</li><li>Do not chase losses, borrow to bet or increase stakes to recover money.</li><li>Avoid betting when upset, intoxicated, tired or under pressure.</li><li>Check your bookmaker history and take regular breaks.</li><li>Use deposit limits, time-outs and self-exclusion tools offered by your bookmaker.</li></ul></section>
    <section><h2>Warning signs</h2><p>Pause and seek help if betting is becoming secretive, causing debt or conflict, affecting sleep or work, taking more time than intended, or making you feel unable to stop. A prediction tool should never override those warning signs.</p></section>
    <section><h2>If you need help now</h2><p>Stop placing bets, close betting apps, ask your bookmakers for a time-out or self-exclusion, and speak with someone you trust. Contact a licensed gambling-support or health service in your country. If you are in immediate danger or at risk of harming yourself, contact local emergency services now.</p></section>
    <section><h2>Under 18</h2><p>OddsAura is only for adults aged 18 or older. If you are under 18, do not create an account or use the predictions and bookmaker tools.</p></section>
    <section><h2>How OddsAura supports safer use</h2><p>We label uncertainty, avoid guarantees, show missing information, encourage final-slip checks and exclude unsupported markets from recommendations. If something in the product appears misleading, please report it through <Link href="/contact">Contact</Link>.</p></section>
  </LegalShell>;
}
