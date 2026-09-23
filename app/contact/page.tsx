import type { Metadata } from "next";
import LegalShell from "../legal-shell";

export const metadata: Metadata = { title: "Contact | OddsAura", description: "Contact OddsAura about support, privacy, safety or account requests.", alternates: { canonical: "/contact" } };

export default function ContactPage() {
  return <LegalShell kicker="Help and requests" title="Contact us.">
    <section><h2>Product and account support</h2><div className="legal-contact-card"><h3>Get help with OddsAura</h3><p>For login problems, incorrect match information, booking-code failures, safety concerns or general feedback.</p><a href="mailto:support@oddsaura.site?subject=OddsAura%20support">support@oddsaura.site</a></div></section>
    <section><h2>Privacy and data requests</h2><p>To request access, correction, export or deletion of personal information, email <a href="mailto:privacy@oddsaura.site?subject=OddsAura%20privacy%20request">privacy@oddsaura.site</a>. Use the email address registered to your OddsAura account and describe the request clearly. We may ask for reasonable verification before acting.</p></section>
    <section><h2>What to include</h2><ul><li>The page or feature involved.</li><li>The exact wording of any error.</li><li>The bookmaker and booking code, if relevant—but never your bookmaker password.</li><li>A screenshot with payment, identity and other sensitive details removed.</li></ul></section>
    <section><h2>Security reports</h2><p>If you believe you found a security issue, email <a href="mailto:security@oddsaura.site?subject=OddsAura%20security%20report">security@oddsaura.site</a>. Do not access other users’ data, disrupt the service or publish an exploitable issue before it can be reviewed.</p></section>
  </LegalShell>;
}
