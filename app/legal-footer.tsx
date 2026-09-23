import Link from "next/link";

export default function LegalFooter({ className = "" }: { className?: string }) {
  return <footer className={`legal-links ${className}`.trim()} aria-label="Legal and support">
    <span>© {new Date().getFullYear()} OddsAura</span>
    <nav>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/responsible-gambling">Play responsibly</Link>
      <Link href="/contact">Contact</Link>
    </nav>
    <small>18+ · OddsAura is an analysis tool, not a bookmaker.</small>
  </footer>;
}
