import Link from "next/link";
import AuthForm from "../auth-form";
import Brand from "../brand";
import "../login/auth.css";

export default function ForgotPasswordPage() {
  return <main className="auth-page"><header><Brand /><Link href="/login">Back to login</Link></header><div className="auth-layout auth-layout-single"><section className="auth-card"><span className="auth-kicker">Account recovery</span><h2>Reset your<br /><i>password.</i></h2><p>Enter your email address. If it belongs to an OddsAura account, we&apos;ll send a secure reset link.</p><AuthForm mode="forgot" /><small>Remembered it? <Link href="/login">Return to login</Link></small></section></div></main>;
}
