import Link from "next/link";
import AuthForm from "../auth-form";
import Brand from "../brand";
import "../login/auth.css";

export default function ResetPasswordPage() {
  return <main className="auth-page"><header><Brand /><Link href="/login">Back to login</Link></header><div className="auth-layout auth-layout-single"><section className="auth-card"><span className="auth-kicker">Choose a new password</span><h2>Secure your<br /><i>account.</i></h2><p>Your new password must contain at least eight characters.</p><AuthForm mode="reset" /></section></div></main>;
}
