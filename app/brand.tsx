import Link from "next/link";

type BrandProps = {
  href?: string;
  className?: string;
  compact?: boolean;
};

export function OddsAuraMark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 48 48" role="img" aria-label="OddsAura">
    <circle cx="24" cy="24" r="21" fill="#f7f8f2" stroke="#0b1426" strokeWidth="3" />
    <path d="M11 31.5 19.2 24l6 3.4L37 16.8" fill="none" stroke="#c7fa45" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="37" cy="16.8" r="3.3" fill="#c7fa45" />
  </svg>;
}

export default function Brand({ href = "/", className = "", compact = false }: BrandProps) {
  return <Link href={href} className={`brand-lockup ${className}`.trim()} aria-label="OddsAura home">
    <OddsAuraMark className="brand-mark" />
    {!compact && <span>Odds<i>Aura</i></span>}
  </Link>;
}
