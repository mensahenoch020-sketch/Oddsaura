import Link from "next/link";
import AuthForm from "../auth-form";
import Brand from "../brand";
import "../login/auth.css";

export default function SignupPage() {
  return <main className="auth-page"><header><Brand /><Link href="/login">Already registered?</Link></header><div className="auth-layout"><section className="auth-story"><span className="auth-kicker">Free OddsAura account</span><h1>Make every pick<br /><i>easy to revisit.</i></h1><p>Create one account for your selected matches, SportyBet codes, shared JPEGs and tracked results.</p><ul><li>Private prediction dashboard</li><li>Saved tickets across devices</li><li>Editable profile and security settings</li></ul></section><section className="auth-card"><span className="auth-kicker">Create your account</span><h2>Start building<br /><i>better slips.</i></h2><p>It takes less than a minute.</p><AuthForm mode="signup" /><small>Already have an account? <Link href="/login">Log in</Link></small></section></div></main>;
}
