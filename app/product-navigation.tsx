import Link from "next/link";
import Brand from "./brand";
import "./product-navigation.css";
import "./compact-theme.css";

export type ProductArea = "home" | "matches" | "predictions" | "slip" | "profile";

const items: Array<{ id: ProductArea; href: string; label: string; icon: React.ReactNode }> = [
  { id: "home", href: "/dashboard", label: "Home", icon: <path d="M4 10.5 12 4l8 6.5V20h-5v-6H9v6H4z" /> },
  { id: "matches", href: "/matches", label: "Matches", icon: <><circle cx="12" cy="12" r="8.5" /><path d="m9.5 9 2.5-1.5L14.5 9l-.9 3H10.4zM6.2 14l4.2-2m7.4 2-4.2-2M12 7.5V3.6" /></> },
  { id: "predictions", href: "/results", label: "Results", icon: <><path d="M5 19V9m7 10V5m7 14v-7" /><path d="m3.5 11 3-3 4 2 4-5 5 3" /></> },
  { id: "slip", href: "/builder#my-slip", label: "My Slip", icon: <><path d="M5 4h14v16l-2.5-1.5L14 20l-2.5-1.5L9 20l-4-2.2z" /><path d="M8 8h8M8 12h8" /></> },
  { id: "profile", href: "/account", label: "Profile", icon: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.5-4 2.8-6 7-6s6.5 2 7 6" /></> },
];

function NavIcon({ children }: { children: React.ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export default function ProductNavigation({ active, slipCount = 0 }: { active: ProductArea; slipCount?: number }) {
  return <>
    <header className="product-header">
      <Brand href="/dashboard" className="product-brand" />
      <nav className="product-desktop-nav" aria-label="Main navigation">
        {items.map((item) => <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined} className={active === item.id ? "active" : ""}>{item.label}{item.id === "slip" && slipCount > 0 ? <b>{slipCount}</b> : null}</Link>)}
      </nav>
      <Link className="product-profile" href="/account" aria-label="Open profile and settings"><span>Profile</span><i aria-hidden="true">OA</i></Link>
    </header>
    <nav className="product-mobile-nav" aria-label="Mobile navigation">
      {items.map((item) => <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined} className={active === item.id ? "active" : ""}>
        <span className="product-nav-icon"><NavIcon>{item.icon}</NavIcon>{item.id === "slip" && slipCount > 0 ? <b>{slipCount}</b> : null}</span>
        <small>{item.label}</small>
      </Link>)}
    </nav>
  </>;
}
