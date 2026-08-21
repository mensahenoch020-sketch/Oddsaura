import Link from "next/link";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import "./auth.css";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getChatGPTUser();
  return <main className="auth-page">
    <header><Link href="/" className="auth-brand"><span>↗</span>Odds<i>Aura</i></Link><Link href="/builder">Browse predictions</Link></header>
    <section className="auth-card">
      <span className="auth-kicker">OddsAura account</span>
      {user ? <>
        <h1>Welcome back,<br /><i>{user.displayName}</i></h1>
        <p>Your account is active. Save prediction slips across devices and reopen them from your dashboard.</p>
        <div className="auth-actions"><Link className="primary" href="/account">Open my account</Link><a href={chatGPTSignOutPath("/")}>Sign out</a></div>
      </> : <>
        <h1>Keep your slips.<br /><i>Come back anytime.</i></h1>
        <p>Create or access your free OddsAura account securely with ChatGPT. Browsing predictions remains available without signing in.</p>
        <div className="auth-actions"><a className="primary" href={chatGPTSignInPath("/account")}>Create account / Sign in</a><Link href="/builder">Continue as guest</Link></div>
        <small>OddsAura never receives your ChatGPT password. Authentication is handled by the sign-in provider.</small>
      </>}
    </section>
  </main>;
}
