import Link from "next/link";
import Brand from "./brand";

export default function NotFound() {
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#f4f1ea", color: "#0b1730", fontFamily: "Arial, sans-serif" }}>
    <section style={{ width: "min(560px,100%)", padding: "42px 28px", borderRadius: 28, background: "#fff", boxShadow: "0 30px 80px rgba(11,23,48,.12)", textAlign: "center" }}>
      <Brand /><p style={{ marginTop: 32, color: "#087a3b", fontWeight: 900, letterSpacing: ".12em", fontSize: 11 }}>404 · PAGE NOT FOUND</p>
      <h1 style={{ fontSize: "clamp(38px,8vw,68px)", lineHeight: .95, letterSpacing: "-.06em", margin: "14px 0" }}>That page is off the pitch.</h1>
      <p style={{ color: "#667085", lineHeight: 1.6 }}>The link may be old, or the page may have moved.</p>
      <Link href="/" style={{ display: "inline-block", marginTop: 16, padding: "13px 18px", borderRadius: 11, background: "#0b1730", color: "#fff", textDecoration: "none", fontWeight: 800 }}>Return to OddsAura</Link>
    </section>
  </main>;
}
