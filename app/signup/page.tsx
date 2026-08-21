import Link from "next/link";
import { chatGPTSignInPath } from "../chatgpt-auth";
import "../login/auth.css";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return <main className="auth-page">
    <header><Link href="/" className="auth-brand"><span>↗</span>Odds<i>Aura</i></Link><Link href="/login">Already registered?</Link></header>
    <section className="auth-card">
      <span className="auth-kicker">Free OddsAura account</span>
      <h1>Keep every ticket.<br /><i>Track every result.</i></h1>
      <p>Create your secure account to save prediction slips, generate booking codes and follow your ticket history across devices.</p>
      <div className="auth-actions"><a className="primary" href={chatGPTSignInPath("/account")}>Create my account</a><Link href="/login">Sign in instead</Link></div>
      <small>Account identity is handled securely. OddsAura never sees or stores your provider password.</small>
    </section>
  </main>;
}
