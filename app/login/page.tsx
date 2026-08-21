import Link from "next/link";
import AuthForm from "../auth-form";
import Brand from "../brand";
import "./auth.css";

export default function LoginPage() {
  return <main className="auth-page"><header><Brand /><Link href="/signup">Create account</Link></header><div className="auth-layout"><section className="auth-story"><span className="auth-kicker">One private workspace</span><h1>Your slips.<br /><i>Your history.</i></h1><p>Log in to unlock qualified predictions, generate booking codes and continue from any device.</p><ul><li>Save and reopen prediction slips</li><li>Keep generated booking codes together</li><li>Track tickets and calculated returns</li></ul></section><section className="auth-card"><span className="auth-kicker">Welcome back</span><h2>Log in to<br /><i>OddsAura.</i></h2><p>Enter the details you used when creating your account.</p><AuthForm mode="login" /><small>New here? <Link href="/signup">Create a free account</Link></small></section></div></main>;
}
