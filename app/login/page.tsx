import Link from "next/link";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import "./auth.css";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getChatGPTUser();
  return <main className="auth-page">
    <header><Link href="/" className="auth-brand"><span>↗</span>Odds<i>Aura</i></Link><Link href="/signup">Create account</Link></header>
    <section className="auth-card">
      <span className="auth-kicker">OddsAura account</span>
      {user ? <>
        <h1>Welcome back,<br /><i>{user.displayName}</i></h1>
        <p>Your account is active. Save prediction slips across devices and reopen them from your dashboard.</p>
        <div className="auth-actions"><Link className="primary" href="/account">Open my account</Link><a href={chatGPTSignOutPath("/")}>Sign out</a></div>
      </> : <>
        <h1>Keep your slips.<br /><i>Come back anytime.</i></h1>
        <p>Sign in to save slips, reopen booking codes and keep your ticket history together across devices.</p>
        <div className="auth-actions"><a className="primary" href={chatGPTSignInPath("/account")}>Sign in securely</a><Link href="/signup">Create a free account</Link></div>
        <small>Your password is handled by the secure identity provider and is never visible to OddsAura.</small>
      </>}
    </section>
  </main>;
}
